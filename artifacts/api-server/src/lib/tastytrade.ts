import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { RawData } from "ws";
import { loadServerEnvIntoProcess } from "./server-env.js";

loadServerEnvIntoProcess();

const API_BASE_URL = "https://api.tastytrade.com";
const TOKEN_BASE_URL = "https://api.tastyworks.com";
const REFRESH_TOKEN_PATH =
  process.env.TASTYTRADE_REFRESH_TOKEN_PATH ??
  path.resolve(process.cwd(), ".tastytrade-refresh-token");

interface AccessToken {
  value: string;
  expiresAt: number;
}

interface TastytradeTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface TastytradeItemsResponse<TItem> {
  data?: {
    items?: TItem[];
  };
}

interface TastytradeDataResponse<TData> {
  data?: TData;
}

interface QuoteTokenResponse {
  data?: {
    token?: string;
    "streamer-url"?: string;
    "dxlink-url"?: string;
    streamerUrl?: string;
    dxlinkUrl?: string;
  };
}

interface DxLinkMessage {
  type?: string;
  channel?: number;
  [key: string]: unknown;
}

export interface StreamedQuote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  mark: number;
  volume: number;
  bidSize: number;
  askSize: number;
  dayHigh?: number;
  dayLow?: number;
  previousClose?: number;
}

export interface StreamedGreeks {
  symbol: string;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
}

export interface TtMarketMetrics {
  iv: number;
  ivRank: number;
  ivPercentile: number;
  hv30: number;
  hv60: number;
  hv90: number;
}

export interface TtQuoteSnapshot {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  mark: number;
  volume: number;
}

export interface MarginRequirementLegInput {
  instrument_type: string;
  symbol: string;
  quantity: number;
  action: string;
}

export interface MarginRequirementRequest {
  symbol: string;
  legs: MarginRequirementLegInput[];
}

export interface MarginRequirementResponse {
  buyingPowerEffect: number;
  isolatedOrderMarginRequirement: number;
  costEffect: number;
  changeInMarginRequirement: number;
  raw: unknown;
}

export interface TtTransaction {
  id: string;
  symbol: string;
  action: string;
  quantity: number;
  price: number;
  executedAt: string;
  description: string;
}

export interface TtNetLiqPoint {
  time: string;
  close: number;
}

export interface TtLivePosition {
  symbol: string;
  streamerSymbol: string | null;
  instrumentType: string;
  underlying: string;
  quantity: number;
  direction: "Long" | "Short";
  openPrice: number;
  currentPrice: number;
  multiplier: number;
  costEffect: "Debit" | "Credit";
  expiresAt: string | null;
  createdAt: string;
  livePrice: number | null;
  liveGreeks: StreamedGreeks | null;
  unrealizedPnl: number | null;
}

export interface OptionContract {
  symbol: string;
  streamerSymbol?: string | null;
  optionType: "call" | "put";
  strikePrice: number;
  expiration: string;
  daysToExpiration: number;
  bid: number;
  ask: number;
  mid: number;
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho?: number;
  openInterest: number;
  volume: number;
  greeksSource: "live" | "rest" | "none";
}

export interface OptionsChainExpiry {
  expiration: string;
  daysToExpiration: number;
  settlementType: string;
  contracts: OptionContract[];
}

export interface OptionsChain {
  underlying: string;
  expirations: OptionsChainExpiry[];
}

export type ContractLookup = (
  type: "call" | "put",
  strike: number,
  expiry: string,
) => { mid: number; iv: number } | null;

export const streamerEvents = new EventEmitter();

const DEFAULT_QUOTE_FIELDS = [
  "eventSymbol",
  "bidPrice",
  "askPrice",
  "bidSize",
  "askSize",
] as const;

const DEFAULT_TRADE_FIELDS = [
  "eventSymbol",
  "price",
  "size",
  "dayVolume",
  "dayHighPrice",
  "dayLowPrice",
  "dayClosePrice",
] as const;

const DEFAULT_GREEKS_FIELDS = [
  "eventSymbol",
  "delta",
  "gamma",
  "theta",
  "vega",
  "rho",
  "volatility",
] as const;

const STREAM_FEED_CHANNEL = 1;
const STREAM_RETRY_BASE_MS = 5000;
const STREAM_RETRY_MAX = 3;
const CHAIN_TTL = 5 * 60 * 1000;
const METRICS_TTL = 15 * 60 * 1000;

let _token: AccessToken | null = null;
let _accountNumber: string | null = process.env.TASTYTRADE_ACCOUNT_NUMBER ?? null;
let _fileRefreshToken: string | null | undefined;
let _runtimeRefreshToken: string | null = null;

let streamerSocket: WebSocket | null = null;
let streamerInitPromise: Promise<void> | null = null;
let streamerConnected = false;
let streamerOpen = false;
let streamerAuthenticated = false;
let streamerFeedOpen = false;
let streamerBackoffAttempts = 0;
let streamerReconnectTimer: NodeJS.Timeout | null = null;
let streamerKeepaliveTimer: NodeJS.Timeout | null = null;
let streamerExpectedClose = false;
let streamerDxlinkUrl: string | null = null;
let streamerQuoteToken: string | null = null;

const feedFieldMap = new Map<string, string[]>();
const subscribedQuoteSymbols = new Set<string>();
const subscribedOptionSymbols = new Set<string>();
const sentQuoteSymbols = new Set<string>();
const sentOptionSymbols = new Set<string>();
const streamedQuotes = new Map<string, StreamedQuote>();
const streamedGreeks = new Map<string, StreamedGreeks>();

const chainCache = new Map<string, { data: OptionsChain; exp: number }>();
const metricsCache = new Map<string, { data: TtMarketMetrics; exp: number }>();

const num = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeOptionSymbol(symbol: string): string {
  return symbol.trim();
}

function eventSymbolFromRecord(record: Record<string, unknown>): string {
  return String(
    record.eventSymbol ??
      record.symbol ??
      record.event_symbol ??
      "",
  ).trim();
}

function readPersistedRefreshToken(): string {
  if (_fileRefreshToken !== undefined) {
    return _fileRefreshToken ?? "";
  }

  try {
    const token = fs.readFileSync(REFRESH_TOKEN_PATH, "utf8").trim();
    _fileRefreshToken = token || null;
  } catch {
    _fileRefreshToken = null;
  }

  return _fileRefreshToken ?? "";
}

function persistRefreshToken(token: string): void {
  try {
    fs.writeFileSync(REFRESH_TOKEN_PATH, `${token}\n`, { encoding: "utf8" });
    _fileRefreshToken = token;
  } catch (err) {
    console.warn("[TT] failed to persist refresh token:", (err as Error).message);
  }
}

function getRefreshToken(): string {
  return _runtimeRefreshToken ?? process.env.TASTYTRADE_REFRESH_TOKEN ?? readPersistedRefreshToken();
}

export function setRuntimeRefreshToken(token: string): void {
  _runtimeRefreshToken = token;
  persistRefreshToken(token);
}

export function isTastytradeOAuthConfigured(): boolean {
  return Boolean(process.env.TASTYTRADE_CLIENT_ID && process.env.TASTYTRADE_CLIENT_SECRET);
}

export function isTastytradeEnabled(): boolean {
  return isTastytradeOAuthConfigured();
}

export function isTastytradeAuthorized(): boolean {
  return _token !== null || Boolean(getRefreshToken());
}

export function getTastytradeTokenExpiry(): number | null {
  return _token?.expiresAt ?? null;
}

async function getToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 2 * 60 * 1000) {
    return _token.value;
  }

  const clientId = process.env.TASTYTRADE_CLIENT_ID ?? "";
  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET ?? "";
  const refreshToken = getRefreshToken();

  console.log(
    "[TT] getToken: clientId present =",
    Boolean(clientId),
    "| clientSecret present =",
    Boolean(clientSecret),
    "| refreshToken present =",
    Boolean(refreshToken),
  );

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing TASTYTRADE_CLIENT_ID, TASTYTRADE_CLIENT_SECRET, or TASTYTRADE_REFRESH_TOKEN");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${TOKEN_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "tastytrade-api-client/1.0",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TT token refresh failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as TastytradeTokenResponse;
  const accessToken = json.access_token;
  const expiresIn = json.expires_in ?? 900;

  if (!accessToken) {
    throw new Error("TT token refresh succeeded but response missing access_token");
  }

  if (json.refresh_token && json.refresh_token !== refreshToken) {
    setRuntimeRefreshToken(json.refresh_token);
    console.log("[TT] getToken: refresh token rotated");
  }

  _token = {
    value: accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return _token.value;
}

async function ttGet<T = unknown>(path: string): Promise<T> {
  const token = await getToken();
  const request = async (bearer: string) =>
    fetch(`${API_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "User-Agent": "tastytrade-api-client/1.0",
      },
    });

  let res = await request(token);
  if (res.status === 401) {
    _token = null;
    const refreshedToken = await getToken();
    res = await request(refreshedToken);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TT ${path} -> ${res.status}${body ? `: ${body}` : ""}`);
  }

  return (await res.json()) as T;
}

async function ttPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getToken();
  const request = async (bearer: string) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        "User-Agent": "tastytrade-api-client/1.0",
      },
      body: JSON.stringify(body),
    });

  let res = await request(token);
  if (res.status === 401) {
    _token = null;
    const refreshedToken = await getToken();
    res = await request(refreshedToken);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TT ${path} -> ${res.status}${text ? `: ${text}` : ""}`);
  }

  return (await res.json()) as T;
}

async function getAccountNumber(): Promise<string> {
  if (_accountNumber) {
    return _accountNumber;
  }

  const json = await ttGet<TastytradeItemsResponse<Record<string, unknown>>>("/customers/me/accounts");
  const items = json.data?.items ?? [];
  const account = items.find((item) => typeof item["account-number"] === "string");

  if (!account || typeof account["account-number"] !== "string") {
    throw new Error("TT account lookup failed: no account-number returned from /customers/me/accounts");
  }

  _accountNumber = account["account-number"];
  return _accountNumber;
}

function extractQuoteToken(json: QuoteTokenResponse): { token: string; dxlinkUrl: string } {
  const data = json.data ?? {};
  const token = data.token ?? "";
  const dxlinkUrl =
    data["dxlink-url"] ??
    data.dxlinkUrl ??
    data["streamer-url"] ??
    data.streamerUrl ??
    "";

  if (!token || !dxlinkUrl) {
    throw new Error("TT quote token response missing token or dxlink-url");
  }

  return { token, dxlinkUrl };
}

async function getApiQuoteToken(): Promise<{ token: string; dxlinkUrl: string }> {
  const json = await ttGet<QuoteTokenResponse>("/api-quote-tokens");
  return extractQuoteToken(json);
}

function clearReconnectTimer(): void {
  if (streamerReconnectTimer) {
    clearTimeout(streamerReconnectTimer);
    streamerReconnectTimer = null;
  }
}

function clearKeepaliveTimer(): void {
  if (streamerKeepaliveTimer) {
    clearInterval(streamerKeepaliveTimer);
    streamerKeepaliveTimer = null;
  }
}

function startKeepalive(intervalMs = 15000): void {
  clearKeepaliveTimer();
  streamerKeepaliveTimer = setInterval(() => {
    if (streamerSocket?.readyState === WebSocket.OPEN) {
      streamerSocket.send(JSON.stringify({ type: "KEEPALIVE", channel: 0 }));
    }
  }, intervalMs);
}

function sendStreamerMessage(message: Record<string, unknown>): void {
  if (streamerSocket?.readyState === WebSocket.OPEN) {
    streamerSocket.send(JSON.stringify(message));
  }
}

function ensureDefaultFeedFieldMap(): void {
  if (!feedFieldMap.has("Quote")) feedFieldMap.set("Quote", [...DEFAULT_QUOTE_FIELDS]);
  if (!feedFieldMap.has("Trade")) feedFieldMap.set("Trade", [...DEFAULT_TRADE_FIELDS]);
  if (!feedFieldMap.has("Greeks")) feedFieldMap.set("Greeks", [...DEFAULT_GREEKS_FIELDS]);
}

function requestFeedChannel(): void {
  sendStreamerMessage({
    type: "CHANNEL_REQUEST",
    channel: STREAM_FEED_CHANNEL,
    service: "FEED",
    parameters: {
      contract: "AUTO",
    },
  });
}

function sendFeedSetup(): void {
  ensureDefaultFeedFieldMap();
  sendStreamerMessage({
    type: "FEED_SETUP",
    channel: STREAM_FEED_CHANNEL,
    acceptAggregationPeriod: 0,
    acceptDataFormat: "COMPACT",
    acceptEventFields: {
      Quote: [...DEFAULT_QUOTE_FIELDS],
      Trade: [...DEFAULT_TRADE_FIELDS],
      Greeks: [...DEFAULT_GREEKS_FIELDS],
    },
  });
}

function flushSubscriptions(): void {
  if (!streamerConnected) return;

  const add: Array<{ type: string; symbol: string }> = [];

  for (const symbol of subscribedQuoteSymbols) {
    if (!sentQuoteSymbols.has(symbol)) {
      add.push({ type: "Quote", symbol });
      add.push({ type: "Trade", symbol });
      sentQuoteSymbols.add(symbol);
    }
  }

  for (const symbol of subscribedOptionSymbols) {
    if (!sentOptionSymbols.has(symbol)) {
      add.push({ type: "Quote", symbol });
      add.push({ type: "Greeks", symbol });
      sentOptionSymbols.add(symbol);
    }
  }

  if (add.length > 0) {
    sendStreamerMessage({
      type: "FEED_SUBSCRIPTION",
      channel: STREAM_FEED_CHANNEL,
      add,
    });
  }
}

function resetStreamerStateForReconnect(): void {
  streamerConnected = false;
  streamerOpen = false;
  streamerAuthenticated = false;
  streamerFeedOpen = false;
  sentQuoteSymbols.clear();
  sentOptionSymbols.clear();
  clearKeepaliveTimer();
}

function scheduleStreamerReconnect(): void {
  if (streamerExpectedClose || streamerBackoffAttempts >= STREAM_RETRY_MAX) {
    if (streamerBackoffAttempts >= STREAM_RETRY_MAX) {
      console.warn("[TT] DXLink reconnect limit reached; falling back to REST");
    }
    return;
  }

  clearReconnectTimer();
  const delay = STREAM_RETRY_BASE_MS * Math.pow(2, streamerBackoffAttempts);
  streamerBackoffAttempts += 1;
  streamerReconnectTimer = setTimeout(() => {
    initStreamer().catch(() => {});
  }, delay);
}

function toRecordFromCompact(fields: string[], row: unknown[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  fields.forEach((field, index) => {
    record[field] = row[index];
  });
  return record;
}

function updateQuoteFromRecord(record: Record<string, unknown>): void {
  const symbol = normalizeOptionSymbol(eventSymbolFromRecord(record));
  if (!symbol) return;

  const previous = streamedQuotes.get(symbol);
  const bid = num(record.bidPrice ?? previous?.bid);
  const ask = num(record.askPrice ?? previous?.ask);
  const last = num(record.price ?? record.lastPrice ?? previous?.last);
  const volume = num(record.dayVolume ?? previous?.volume);
  const bidSize = num(record.bidSize ?? previous?.bidSize);
  const askSize = num(record.askSize ?? previous?.askSize);
  const dayHigh = num(record.dayHighPrice ?? previous?.dayHigh);
  const dayLow = num(record.dayLowPrice ?? previous?.dayLow);
  const previousClose = num(record.dayClosePrice ?? previous?.previousClose);
  const mark =
    bid > 0 && ask > 0
      ? round2((bid + ask) / 2)
      : last > 0
        ? round2(last)
        : bid > 0
          ? round2(bid)
          : round2(ask);

  const quote: StreamedQuote = {
    symbol,
    bid: round2(bid),
    ask: round2(ask),
    last: round2(last),
    mark,
    volume,
    bidSize,
    askSize,
    ...(dayHigh > 0 ? { dayHigh: round2(dayHigh) } : {}),
    ...(dayLow > 0 ? { dayLow: round2(dayLow) } : {}),
    ...(previousClose > 0 ? { previousClose: round2(previousClose) } : {}),
  };

  streamedQuotes.set(symbol, quote);
  streamerEvents.emit("quote", quote);
}

function updateGreeksFromRecord(record: Record<string, unknown>): void {
  const symbol = normalizeOptionSymbol(eventSymbolFromRecord(record));
  if (!symbol) return;

  const previous = streamedGreeks.get(symbol);
  const greeks: StreamedGreeks = {
    symbol,
    delta: round3(num(record.delta ?? previous?.delta)),
    gamma: round3(num(record.gamma ?? previous?.gamma)),
    theta: round3(num(record.theta ?? previous?.theta)),
    vega: round3(num(record.vega ?? previous?.vega)),
    rho: round3(num(record.rho ?? previous?.rho)),
    iv: round3(num(record.volatility ?? record.impliedVolatility ?? previous?.iv) * (num(record.volatility ?? record.impliedVolatility) > 1 ? 1 : 100)),
  };

  streamedGreeks.set(symbol, greeks);
  streamerEvents.emit("greeks", greeks);
}

function processFeedPayload(eventType: string, payload: unknown): void {
  if (payload == null) return;

  if (Array.isArray(payload) && payload.length > 0 && Array.isArray(payload[0])) {
    for (const row of payload as unknown[][]) {
      processFeedPayload(eventType, row);
    }
    return;
  }

  let record: Record<string, unknown> | null = null;
  if (Array.isArray(payload)) {
    const fields =
      feedFieldMap.get(eventType) ??
      (eventType === "Quote"
        ? [...DEFAULT_QUOTE_FIELDS]
        : eventType === "Trade"
          ? [...DEFAULT_TRADE_FIELDS]
          : [...DEFAULT_GREEKS_FIELDS]);
    record = toRecordFromCompact(fields, payload as unknown[]);
  } else if (typeof payload === "object") {
    record = payload as Record<string, unknown>;
  }

  if (!record) return;

  if (eventType === "Quote" || eventType === "Trade") {
    updateQuoteFromRecord(record);
  }
  if (eventType === "Greeks") {
    updateGreeksFromRecord(record);
  }
}

function handleFeedData(message: Record<string, unknown>): void {
  const feedData = Array.isArray(message.data)
    ? (message.data as unknown[])
    : Array.isArray(message.events)
      ? (message.events as unknown[])
      : [];

  for (const entry of feedData) {
    if (Array.isArray(entry) && typeof entry[0] === "string") {
      const eventType = entry[0];
      const rows = entry.slice(1);
      for (const row of rows) {
        processFeedPayload(eventType, row);
      }
      continue;
    }

    if (typeof entry === "object" && entry !== null) {
      const row = entry as Record<string, unknown>;
      const eventType = String(row.eventType ?? row.type ?? "");
      if (eventType) {
        processFeedPayload(eventType, row.data ?? row.event ?? row);
      }
    }
  }
}

function handleStreamerMessage(raw: RawData): void {
  const text = typeof raw === "string" ? raw : raw.toString();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const typedMessage = message as DxLinkMessage;
    const type = typedMessage.type ?? "";

    switch (type) {
      case "SETUP":
        streamerOpen = true;
        startKeepalive(num(typedMessage.keepaliveTimeout) > 0 ? num(typedMessage.keepaliveTimeout) * 500 : 15000);
        if (streamerQuoteToken) {
          sendStreamerMessage({
            type: "AUTH",
            channel: 0,
            token: streamerQuoteToken,
          });
        }
        break;
      case "AUTH_STATE":
        if (typedMessage.state === "AUTHORIZED") {
          streamerAuthenticated = true;
          requestFeedChannel();
        } else if (typedMessage.state === "UNAUTHORIZED") {
          console.warn("[TT] DXLink authorization failed");
        }
        break;
      case "CHANNEL_OPENED":
        if (typedMessage.channel === STREAM_FEED_CHANNEL) {
          streamerFeedOpen = true;
          streamerConnected = true;
          streamerBackoffAttempts = 0;
          sendFeedSetup();
          flushSubscriptions();
        }
        break;
      case "FEED_CONFIG": {
        const eventFields = typedMessage.eventFields;
        if (eventFields && typeof eventFields === "object") {
          for (const [eventType, fields] of Object.entries(eventFields as Record<string, unknown>)) {
            if (Array.isArray(fields)) {
              feedFieldMap.set(eventType, fields.map((field) => String(field)));
            }
          }
        }
        flushSubscriptions();
        break;
      }
      case "FEED_DATA":
        handleFeedData(typedMessage as Record<string, unknown>);
        break;
      case "CHANNEL_CLOSED":
        console.warn("[TT] DXLink feed channel closed");
        break;
      case "ERROR":
        console.warn("[TT] DXLink error:", JSON.stringify(typedMessage));
        break;
      default:
        break;
    }
  }
}

async function connectStreamer(): Promise<void> {
  if (!isTastytradeAuthorized()) {
    console.warn("[TT] streamer init skipped: not authorized");
    return;
  }

  const { token, dxlinkUrl } = await getApiQuoteToken();
  streamerQuoteToken = token;
  streamerDxlinkUrl = dxlinkUrl;

  await new Promise<void>((resolve) => {
    resetStreamerStateForReconnect();
    streamerExpectedClose = false;
    clearReconnectTimer();

    const socket = new WebSocket(dxlinkUrl);
    streamerSocket = socket;

    socket.on("open", () => {
      sendStreamerMessage({
        type: "SETUP",
        channel: 0,
        keepaliveTimeout: 60,
        acceptKeepaliveTimeout: 60,
        version: "0.1-js/1.0.0",
      });
      resolve();
    });

    socket.on("message", (raw: RawData) => {
      handleStreamerMessage(raw);
    });

    socket.on("error", (err: Error) => {
      console.warn("[TT] DXLink socket error:", err.message);
    });

    socket.on("close", () => {
      streamerSocket = null;
      resetStreamerStateForReconnect();
      scheduleStreamerReconnect();
    });
  });
}

export async function initStreamer(): Promise<void> {
  if (streamerConnected || streamerFeedOpen) {
    return;
  }

  if (streamerInitPromise) {
    return streamerInitPromise;
  }

  streamerInitPromise = connectStreamer()
    .catch((err) => {
      streamerConnected = false;
      console.warn("[TT] DXLink init failed:", (err as Error).message);
    })
    .finally(() => {
      streamerInitPromise = null;
    });

  return streamerInitPromise;
}

export function isStreamerConnected(): boolean {
  return streamerConnected;
}

export function subscribeQuotes(symbols: string[]): void {
  for (const symbol of symbols.map(normalizeSymbol).filter(Boolean)) {
    subscribedQuoteSymbols.add(symbol);
  }

  if (!streamerConnected) {
    initStreamer().catch(() => {});
    return;
  }

  flushSubscriptions();
}

export function subscribeGreeks(optionSymbols: string[]): void {
  for (const symbol of optionSymbols.map(normalizeOptionSymbol).filter(Boolean)) {
    subscribedOptionSymbols.add(symbol);
  }

  if (!streamerConnected) {
    initStreamer().catch(() => {});
    return;
  }

  flushSubscriptions();
}

export function getStreamedQuote(symbol: string): StreamedQuote | null {
  return streamedQuotes.get(normalizeOptionSymbol(symbol)) ?? streamedQuotes.get(normalizeSymbol(symbol)) ?? null;
}

export function getStreamedGreeks(symbol: string): StreamedGreeks | null {
  return streamedGreeks.get(normalizeOptionSymbol(symbol)) ?? null;
}

export function getStreamerStatus(): { connected: boolean; subscribedSymbols: number; subscribedOptions: number } {
  return {
    connected: streamerConnected,
    subscribedSymbols: subscribedQuoteSymbols.size,
    subscribedOptions: subscribedOptionSymbols.size,
  };
}

export async function initTastytrade(log: { info: (msg: string) => void; warn: (msg: string) => void }): Promise<void> {
  const clientId = process.env.TASTYTRADE_CLIENT_ID ?? "";
  const secret = process.env.TASTYTRADE_CLIENT_SECRET ?? "";
  const refresh = getRefreshToken();

  log.info(`[TT] initTastytrade: CLIENT_ID=${Boolean(clientId)} CLIENT_SECRET=${Boolean(secret)} REFRESH_TOKEN=${Boolean(refresh)}`);

  if (!clientId || !secret) {
    log.warn("[TT] initTastytrade: TASTYTRADE_CLIENT_ID or TASTYTRADE_CLIENT_SECRET missing - Tastytrade disabled");
    return;
  }

  if (!refresh) {
    log.warn("[TT] initTastytrade: TASTYTRADE_REFRESH_TOKEN missing - visit /api/auth/tastytrade to connect");
    return;
  }

  try {
    await getToken();
    log.info("[TT] initTastytrade: connected - access token obtained");
  } catch (err) {
    log.warn(`[TT] initTastytrade: token fetch failed - ${(err as Error).message}`);
  }
}

export function getAuthorizationUrl(redirectUri: string): string {
  const clientId = process.env.TASTYTRADE_CLIENT_ID ?? "";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
  });
  return `${TOKEN_BASE_URL}/oauth/authorize?${params}`;
}

export async function exchangeAuthCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; expiresIn: number }> {
  const clientId = process.env.TASTYTRADE_CLIENT_ID ?? "";
  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET ?? "";

  if (!clientId || !clientSecret) {
    throw new Error("TASTYTRADE_CLIENT_ID and TASTYTRADE_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${TOKEN_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "tastytrade-api-client/1.0",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TT auth code exchange failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as TastytradeTokenResponse;
  const accessToken = json.access_token;
  const newRefresh = json.refresh_token;
  const expiresIn = json.expires_in ?? 900;

  if (!accessToken || !newRefresh) {
    throw new Error("TT code exchange missing access_token or refresh_token in response");
  }

  _token = { value: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  setRuntimeRefreshToken(newRefresh);

  return { refreshToken: newRefresh, expiresIn };
}

export async function getQuoteSnapshots(symbols: string[]): Promise<Map<string, TtQuoteSnapshot>> {
  const unique = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  const result = new Map<string, TtQuoteSnapshot>();

  if (unique.length === 0) return result;

  const json = await ttGet<TastytradeItemsResponse<Record<string, unknown>>>(
    `/market-data/by-type/equities?symbols=${unique.map(encodeURIComponent).join(",")}`,
  );

  for (const item of json.data?.items ?? []) {
    const symbol = normalizeSymbol(String(item.symbol ?? item["event-symbol"] ?? ""));
    if (!symbol) continue;
    const bid = num(item.bid ?? item["bid-price"]);
    const ask = num(item.ask ?? item["ask-price"]);
    const last = num(item.price ?? item.last ?? item["last-price"]);
    const volume = num(item.volume ?? item["day-volume"]);
    result.set(symbol, {
      symbol,
      bid: round2(bid),
      ask: round2(ask),
      last: round2(last),
      mark: bid > 0 && ask > 0 ? round2((bid + ask) / 2) : round2(last || bid || ask),
      volume,
    });
  }

  return result;
}

export async function getOptionsChain(symbol: string): Promise<OptionsChain> {
  const normalized = normalizeSymbol(symbol);
  const key = `chain:${normalized}`;
  const hit = chainCache.get(key);
  if (hit && Date.now() < hit.exp) return hit.data;

  const json = await ttGet<TastytradeItemsResponse<Record<string, unknown>>>(`/option-chains/${encodeURIComponent(normalized)}/nested`);
  const expirations: OptionsChainExpiry[] = [];
  const optionStreamerSymbols = new Set<string>();

  for (const item of json.data?.items ?? []) {
    const expiration = String(item["expiration-date"] ?? "");
    const dte = num(item["days-to-expiration"]);
    const settlementType = String(item["settlement-type"] ?? "");
    const contracts: OptionContract[] = [];

    for (const strike of (item.strikes as Record<string, unknown>[] | undefined) ?? []) {
      const strikePrice = num(strike["strike-price"]);
      for (const type of ["call", "put"] as const) {
        const contractData = strike[type] as Record<string, unknown> | undefined;
        if (!contractData) continue;

        const bid = num(contractData.bid);
        const ask = num(contractData.ask);
        const symbolValue = String(contractData.symbol ?? "");
        const streamerSymbol =
          String(
            contractData["streamer-symbol"] ??
              contractData.streamerSymbol ??
              symbolValue,
          ) || null;

        if (streamerSymbol) {
          optionStreamerSymbols.add(streamerSymbol);
        }

        const liveGreeks = streamerSymbol ? getStreamedGreeks(streamerSymbol) : null;
        contracts.push({
          symbol: symbolValue,
          streamerSymbol,
          optionType: type,
          strikePrice,
          expiration,
          daysToExpiration: dte,
          bid,
          ask,
          mid: num(contractData["mid-price"] ?? (bid + ask) / 2),
          impliedVolatility: liveGreeks?.iv ?? num(contractData["implied-volatility"]) * 100,
          delta: liveGreeks?.delta ?? num(contractData.delta),
          gamma: liveGreeks?.gamma ?? num(contractData.gamma),
          theta: liveGreeks?.theta ?? num(contractData.theta),
          vega: liveGreeks?.vega ?? num(contractData.vega),
          rho: liveGreeks?.rho ?? 0,
          openInterest: num(contractData["open-interest"]),
          volume: num(contractData.volume),
          greeksSource: liveGreeks
            ? "live"
            : num(contractData.delta) || num(contractData.gamma) || num(contractData.theta) || num(contractData.vega)
              ? "rest"
              : "none",
        });
      }
    }

    expirations.push({
      expiration,
      daysToExpiration: dte,
      settlementType,
      contracts,
    });
  }

  if (optionStreamerSymbols.size > 0) {
    subscribeGreeks([...optionStreamerSymbols]);
  }

  const chain: OptionsChain = { underlying: normalized, expirations };
  chainCache.set(key, { data: chain, exp: Date.now() + CHAIN_TTL });
  return chain;
}

export function makeContractLookup(chain: OptionsChain): ContractLookup {
  return (type, targetStrike, targetExpiry) => {
    const targetDte = Math.max(
      0,
      Math.ceil((new Date(targetExpiry).getTime() - Date.now()) / 86_400_000),
    );
    const expiry = chain.expirations.reduce(
      (best, current) =>
        Math.abs(current.daysToExpiration - targetDte) < Math.abs(best.daysToExpiration - targetDte)
          ? current
          : best,
      chain.expirations[0]!,
    );

    if (!expiry) return null;

    const candidates = expiry.contracts.filter((contract) => contract.optionType === type && contract.bid > 0);
    if (candidates.length === 0) return null;

    const best = candidates.reduce((winner, contract) =>
      Math.abs(contract.strikePrice - targetStrike) < Math.abs(winner.strikePrice - targetStrike)
        ? contract
        : winner,
    );

    return { mid: best.mid, iv: best.impliedVolatility };
  };
}

export async function getMarketMetrics(symbols: string[]): Promise<Map<string, TtMarketMetrics>> {
  const now = Date.now();
  const result = new Map<string, TtMarketMetrics>();
  const missing: string[] = [];

  for (const symbol of symbols.map(normalizeSymbol)) {
    const hit = metricsCache.get(symbol);
    if (hit && now < hit.exp) {
      result.set(symbol, hit.data);
    } else {
      missing.push(symbol);
    }
  }

  if (missing.length === 0) {
    return result;
  }

  const chunkSize = 100;
  for (let index = 0; index < missing.length; index += chunkSize) {
    const chunk = missing.slice(index, index + chunkSize);
    try {
      const json = await ttGet<TastytradeItemsResponse<Record<string, unknown>>>(
        `/market-metrics?symbols=${chunk.map(encodeURIComponent).join(",")}`,
      );

      for (const item of json.data?.items ?? []) {
        const symbol = normalizeSymbol(String(item.symbol ?? ""));
        if (!symbol) continue;

        const metrics: TtMarketMetrics = {
          iv: round2(num(item["implied-volatility-index"]) * 100),
          ivRank: Math.round(num(item["implied-volatility-index-rank"]) * 100),
          ivPercentile: Math.round(num(item["implied-volatility-percentile"]) * 100),
          hv30: round2(num(item["hv-30-day"]) * 100),
          hv60: round2(num(item["hv-60-day"]) * 100),
          hv90: round2(num(item["hv-90-day"]) * 100),
        };

        metricsCache.set(symbol, { data: metrics, exp: now + METRICS_TTL });
        result.set(symbol, metrics);
      }
    } catch (err) {
      console.warn("[TT] getMarketMetrics chunk failed:", (err as Error).message);
    }
  }

  return result;
}

export interface TtRawPosition {
  symbol: string;
  streamerSymbol: string | null;
  instrumentType: string;
  underlying: string;
  quantity: number;
  direction: "Long" | "Short";
  openPrice: number;
  currentPrice: number;
  multiplier: number;
  costEffect: "Debit" | "Credit";
  expiresAt: string | null;
  createdAt: string;
  livePrice: number | null;
  liveGreeks: StreamedGreeks | null;
  unrealizedPnl: number | null;
}

function currentMarkFromQuote(symbol: string): number | null {
  const quote = getStreamedQuote(symbol);
  if (!quote) return null;
  return quote.mark || quote.last || quote.bid || quote.ask || null;
}

export async function getRawPositions(): Promise<TtRawPosition[]> {
  const accountNumber = await getAccountNumber();
  const json = await ttGet<TastytradeItemsResponse<Record<string, unknown>>>(`/accounts/${accountNumber}/positions`);
  const items = json.data?.items ?? [];

  const underlyings = new Set<string>();
  const optionStreamerSymbols = new Set<string>();

  for (const item of items) {
    const underlying = normalizeSymbol(String(item["underlying-symbol"] ?? ""));
    if (underlying) underlyings.add(underlying);
    const streamerSymbol = String(item["streamer-symbol"] ?? "").trim();
    if (streamerSymbol) optionStreamerSymbols.add(streamerSymbol);
  }

  if (underlyings.size > 0) subscribeQuotes([...underlyings]);
  if (optionStreamerSymbols.size > 0) subscribeGreeks([...optionStreamerSymbols]);

  return items.map((item) => {
    const symbol = String(item.symbol ?? "");
    const streamerSymbol = String(item["streamer-symbol"] ?? "").trim() || null;
    const underlying = normalizeSymbol(String(item["underlying-symbol"] ?? ""));
    const instrumentType = String(item["instrument-type"] ?? "");
    const direction = (item["quantity-direction"] as "Long" | "Short") ?? "Long";
    const openPrice = num(item["average-open-price"]);
    const currentPrice = num(item["close-price"] ?? item["mark-price"]);
    const multiplier = num(item.multiplier) || 100;
    const livePrice =
      (streamerSymbol ? currentMarkFromQuote(streamerSymbol) : null) ??
      (underlying ? currentMarkFromQuote(underlying) : null);
    const liveGreeks = streamerSymbol ? getStreamedGreeks(streamerSymbol) : null;
    const directionMultiplier = direction === "Long" ? 1 : -1;
    const unrealizedPnl =
      livePrice != null
        ? round2((livePrice - openPrice) * directionMultiplier * num(item.quantity) * multiplier)
        : null;

    return {
      symbol,
      streamerSymbol,
      instrumentType,
      underlying,
      quantity: num(item.quantity),
      direction,
      openPrice,
      currentPrice,
      multiplier,
      costEffect: (item["cost-effect"] as "Debit" | "Credit") ?? "Debit",
      expiresAt: (item["expires-at"] as string) ?? null,
      createdAt: (item["created-at"] as string) ?? "",
      livePrice,
      liveGreeks,
      unrealizedPnl,
    };
  });
}

export async function getPositions(): Promise<TtLivePosition[]> {
  return getRawPositions();
}

export interface TtBalances {
  netLiquidatingValue: number;
  optionBuyingPower: number;
  cashBalance: number;
  realizedDayGain: number;
  unrealizedDayGain: number;
}

export async function getBalances(): Promise<TtBalances> {
  const accountNumber = await getAccountNumber();
  const json = await ttGet<TastytradeDataResponse<Record<string, unknown>>>(`/accounts/${accountNumber}/balances`);
  const data = json.data ?? {};
  return {
    netLiquidatingValue: num(data["net-liquidating-value"]),
    optionBuyingPower: num(data["derivative-buying-power"] ?? data["option-buying-power"]),
    cashBalance: num(data["cash-balance"]),
    realizedDayGain: num(data["realized-day-gain"]),
    unrealizedDayGain: num(data["unrealized-day-gain"]),
  };
}

export async function getAccountBalances(): Promise<TtBalances> {
  return getBalances();
}

export async function getTransactions(limit = 100): Promise<TtTransaction[]> {
  const accountNumber = await getAccountNumber();
  const safeLimit = Math.min(Math.max(limit, 1), 250);
  const json = await ttGet<TastytradeItemsResponse<Record<string, unknown>>>(
    `/accounts/${accountNumber}/transactions?per-page=${safeLimit}`,
  );

  return (json.data?.items ?? []).slice(0, safeLimit).map((item, index) => ({
    id: String(item.id ?? item["transaction-id"] ?? `${index}`),
    symbol: String(item.symbol ?? item["underlying-symbol"] ?? ""),
    action: String(item.action ?? item["transaction-type"] ?? item["value-effect"] ?? ""),
    quantity: num(item.quantity),
    price: num(item.price ?? item["price-effect"] ?? item["net-value"]),
    executedAt: String(item["executed-at"] ?? item["transaction-date"] ?? item["created-at"] ?? ""),
    description: String(item.description ?? item["description"] ?? item["transaction-sub-type"] ?? ""),
  }));
}

export async function getNetLiqHistory(timeBack = "1y"): Promise<TtNetLiqPoint[]> {
  const accountNumber = await getAccountNumber();
  const json = await ttGet<TastytradeItemsResponse<Record<string, unknown>> | TastytradeDataResponse<Record<string, unknown>>>(
    `/accounts/${accountNumber}/net-liq-history?time-back=${encodeURIComponent(timeBack)}`,
  );

  const items =
    (json as TastytradeItemsResponse<Record<string, unknown>>).data?.items ??
    ((json as TastytradeDataResponse<Record<string, unknown>>).data?.["items"] as Record<string, unknown>[] | undefined) ??
    [];

  return items.map((item) => ({
    time: String(item.time ?? item["snapshot-time"] ?? item["occurred-at"] ?? ""),
    close: round2(num(item.close ?? item["net-liquidating-value"] ?? item.value)),
  })).filter((point) => point.time && Number.isFinite(point.close));
}

export async function getMarginRequirement(
  input: MarginRequirementRequest,
): Promise<MarginRequirementResponse> {
  const accountNumber = await getAccountNumber();
  const body = {
    account_number: accountNumber,
    underlying_symbol: input.symbol,
    order_legs: input.legs.map((leg) => ({
      instrument_type: leg.instrument_type,
      symbol: leg.symbol,
      quantity: leg.quantity,
      action: leg.action,
    })),
  };

  const json = await ttPost<TastytradeDataResponse<Record<string, unknown>> | Record<string, unknown>>(
    "/margin-requirements/dry-run",
    body,
  );

  const data = ("data" in json ? (json.data ?? {}) : json) as Record<string, unknown>;
  return {
    buyingPowerEffect: num(data["buying-power-effect"]),
    isolatedOrderMarginRequirement: num(data["isolated-order-margin-requirement"]),
    costEffect: num(data["cost-effect"]),
    changeInMarginRequirement: num(data["change-in-margin-requirement"]),
    raw: data,
  };
}
