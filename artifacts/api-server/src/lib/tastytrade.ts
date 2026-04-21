const API_BASE_URL   = "https://api.tastytrade.com";
const TOKEN_BASE_URL = "https://api.tastyworks.com";

const ACCOUNT = process.env.TASTYTRADE_ACCOUNT_NUMBER ?? "5WI61720";

// ─── Token management ─────────────────────────────────────────────────────

interface AccessToken {
  value:     string;
  expiresAt: number; // ms
}

let _token: AccessToken | null = null;
// Runtime override — set by OAuth callback, survives until process restart
let _runtimeRefreshToken: string | null = null;

function getRefreshToken(): string {
  return _runtimeRefreshToken ?? process.env.TASTYTRADE_REFRESH_TOKEN ?? "";
}

export function setRuntimeRefreshToken(rt: string): void {
  _runtimeRefreshToken = rt;
  _token = null; // force re-auth with the new token
}

export function isTastytradeOAuthConfigured(): boolean {
  return !!(process.env.TASTYTRADE_CLIENT_ID && process.env.TASTYTRADE_CLIENT_SECRET);
}

export function isTastytradeEnabled(): boolean {
  return !!(
    process.env.TASTYTRADE_CLIENT_ID &&
    process.env.TASTYTRADE_CLIENT_SECRET &&
    getRefreshToken()
  );
}

export function isTastytradeAuthorized(): boolean {
  return _token !== null;
}

async function getToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 2 * 60 * 1000) {
    return _token.value;
  }

  const clientId      = process.env.TASTYTRADE_CLIENT_ID ?? "";
  const clientSecret  = process.env.TASTYTRADE_CLIENT_SECRET ?? "";
  const refreshToken  = getRefreshToken();

  console.log("[TT] getToken: clientId present =", !!clientId,
    "| clientSecret present =", !!clientSecret,
    "| refreshToken present =", !!refreshToken);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing TASTYTRADE_CLIENT_ID, TASTYTRADE_CLIENT_SECRET, or TASTYTRADE_REFRESH_TOKEN");
  }

  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const url = `${TOKEN_BASE_URL}/oauth/token`;
  console.log("[TT] getToken: POST", url);

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":   "tastytrade-api-client/1.0",
    },
    body: params.toString(),
  });

  console.log("[TT] getToken: response status =", res.status);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.log("[TT] getToken: error body =", body);
    throw new Error(`TT token refresh failed (${res.status}): ${body}`);
  }

  const json = await res.json() as TastytradeTokenResponse;
  const accessToken = json.access_token as string | undefined;
  const expiresIn   = (json.expires_in as number) ?? 900;

  console.log("[TT] getToken: access_token present =", !!accessToken, "| expires_in =", expiresIn);

  if (!accessToken) {
    throw new Error("TT token refresh succeeded but response missing access_token");
  }

  // Rotate refresh token if the server issued a new one
  if (json.refresh_token && json.refresh_token !== refreshToken) {
    _runtimeRefreshToken = json.refresh_token as string;
    console.log("[TT] getToken: refresh token rotated");
  }

  _token = {
    value:     accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  console.log("[TT] getToken: token stored, expiresAt =", new Date(_token.expiresAt).toISOString());
  return _token.value;
}

export async function initTastytrade(log: { info: (msg: string) => void; warn: (msg: string) => void }): Promise<void> {
  const clientId = process.env.TASTYTRADE_CLIENT_ID ?? "";
  const secret   = process.env.TASTYTRADE_CLIENT_SECRET ?? "";
  const refresh  = getRefreshToken();

  log.info(`[TT] initTastytrade: CLIENT_ID=${!!clientId} CLIENT_SECRET=${!!secret} REFRESH_TOKEN=${!!refresh}`);

  if (!clientId || !secret) {
    log.warn("[TT] initTastytrade: TASTYTRADE_CLIENT_ID or TASTYTRADE_CLIENT_SECRET missing — Tastytrade disabled");
    return;
  }
  if (!refresh) {
    log.warn("[TT] initTastytrade: TASTYTRADE_REFRESH_TOKEN missing — visit /api/auth/tastytrade to connect");
    return;
  }
  try {
    await getToken();
    log.info("[TT] initTastytrade: connected — access token obtained");
  } catch (err: any) {
    log.warn(`[TT] initTastytrade: token fetch failed — ${err.message}`);
  }
}

export function getTastytradeTokenExpiry(): number | null {
  return _token?.expiresAt ?? null;
}

// ─── OAuth helpers ─────────────────────────────────────────────────────────

export function getAuthorizationUrl(redirectUri: string): string {
  const clientId = process.env.TASTYTRADE_CLIENT_ID ?? "";
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  redirectUri,
  });
  return `${TOKEN_BASE_URL}/oauth/authorize?${params}`;
}

export async function exchangeAuthCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; expiresIn: number }> {
  const clientId     = process.env.TASTYTRADE_CLIENT_ID ?? "";
  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET ?? "";

  if (!clientId || !clientSecret) {
    throw new Error("TASTYTRADE_CLIENT_ID and TASTYTRADE_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    redirect_uri:  redirectUri,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${TOKEN_BASE_URL}/oauth/token`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":   "tastytrade-api-client/1.0",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TT auth code exchange failed (${res.status}): ${body}`);
  }

  const json        = await res.json() as TastytradeTokenResponse;
  const accessToken = json.access_token as string;
  const newRefresh  = json.refresh_token as string;
  const expiresIn   = (json.expires_in as number) ?? 900;

  if (!accessToken || !newRefresh) {
    throw new Error("TT code exchange missing access_token or refresh_token in response");
  }

  // Cache the new access token immediately
  _token = { value: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  setRuntimeRefreshToken(newRefresh);

  return { refreshToken: newRefresh, expiresIn };
}

// ─── HTTP helper ──────────────────────────────────────────────────────────

const num = (v: any): number => {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  return 0;
};

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

async function ttGet<T = unknown>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "User-Agent":    "tastytrade-api-client/1.0",
    },
  });
  if (!res.ok) throw new Error(`TT ${path} → ${res.status}`);
  return await res.json() as T;
}

// ─── Options Chain ────────────────────────────────────────────────────────

export interface OptionContract {
  symbol: string;
  optionType: "call" | "put";
  strikePrice: number;
  expiration: string;
  daysToExpiration: number;
  bid: number;
  ask: number;
  mid: number;
  impliedVolatility: number; // percent, e.g. 28.45
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openInterest: number;
  volume: number;
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

const chainCache = new Map<string, { data: OptionsChain; exp: number }>();
const CHAIN_TTL = 5 * 60 * 1000;

export async function getOptionsChain(symbol: string): Promise<OptionsChain> {
  const key = `chain:${symbol}`;
  const hit = chainCache.get(key);
  if (hit && Date.now() < hit.exp) return hit.data;

  const json = await ttGet<TastytradeItemsResponse<any>>(`/option-chains/${encodeURIComponent(symbol)}/nested`);
  const expirations: OptionsChainExpiry[] = [];

  for (const item of (json.data?.items ?? []) as any[]) {
    const expiration: string = item["expiration-date"];
    const dte = num(item["days-to-expiration"]);
    const settlementType: string = item["settlement-type"] ?? "";
    const contracts: OptionContract[] = [];

    for (const strike of (item.strikes ?? []) as any[]) {
      const strikePrice = num(strike["strike-price"]);
      for (const type of ["call", "put"] as const) {
        const c = strike[type];
        if (!c) continue;
        const bid = num(c.bid);
        const ask = num(c.ask);
        contracts.push({
          symbol: (c.symbol as string) ?? "",
          optionType: type,
          strikePrice,
          expiration,
          daysToExpiration: dte,
          bid,
          ask,
          mid: num(c["mid-price"] ?? (bid + ask) / 2),
          impliedVolatility: num(c["implied-volatility"]) * 100,
          delta: num(c.delta),
          gamma: num(c.gamma),
          theta: num(c.theta),
          vega: num(c.vega),
          openInterest: num(c["open-interest"]),
          volume: num(c.volume),
        });
      }
    }
    expirations.push({ expiration, daysToExpiration: dte, settlementType, contracts });
  }

  const chain: OptionsChain = { underlying: symbol, expirations };
  chainCache.set(key, { data: chain, exp: Date.now() + CHAIN_TTL });
  return chain;
}

// ─── Contract lookup (used by strategy engine) ────────────────────────────

export type ContractLookup = (
  type: "call" | "put",
  strike: number,
  expiry: string,
) => { mid: number; iv: number } | null;

export function makeContractLookup(chain: OptionsChain): ContractLookup {
  return (type, targetStrike, targetExpiry) => {
    const targetDte = Math.max(
      0,
      Math.ceil((new Date(targetExpiry).getTime() - Date.now()) / 86_400_000),
    );
    const expiry = chain.expirations.reduce((best, e) =>
      Math.abs(e.daysToExpiration - targetDte) < Math.abs(best.daysToExpiration - targetDte) ? e : best,
    chain.expirations[0]!);
    if (!expiry) return null;

    const candidates = expiry.contracts.filter(c => c.optionType === type && c.bid > 0);
    if (candidates.length === 0) return null;

    const best = candidates.reduce((b, c) =>
      Math.abs(c.strikePrice - targetStrike) < Math.abs(b.strikePrice - targetStrike) ? c : b,
    );
    return { mid: best.mid, iv: best.impliedVolatility };
  };
}

// ─── Market Metrics ───────────────────────────────────────────────────────

export interface TtMarketMetrics {
  iv:           number; // current IV percent (e.g. 25.3)
  ivRank:       number; // 0–100, true IV rank from options price history
  ivPercentile: number; // 0–100
  hv30:         number; // 30-day HV percent
  hv60:         number;
  hv90:         number;
}

const metricsCache = new Map<string, { data: TtMarketMetrics; exp: number }>();
const METRICS_TTL  = 15 * 60 * 1000; // 15 min

export async function getMarketMetrics(symbols: string[]): Promise<Map<string, TtMarketMetrics>> {
  const now     = Date.now();
  const result  = new Map<string, TtMarketMetrics>();
  const missing: string[] = [];

  for (const sym of symbols) {
    const hit = metricsCache.get(sym);
    if (hit && now < hit.exp) result.set(sym, hit.data);
    else missing.push(sym);
  }
  if (missing.length === 0) return result;

  const CHUNK = 100;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    try {
      const json = await ttGet<TastytradeItemsResponse<any>>(`/market-metrics?symbols=${chunk.map(encodeURIComponent).join(",")}`);
      for (const item of (json.data?.items ?? []) as any[]) {
        const sym = item.symbol as string;
        if (!sym) continue;
        const metrics: TtMarketMetrics = {
          iv:           Math.round(num(item["implied-volatility-index"])      * 100 * 100) / 100,
          ivRank:       Math.round(num(item["implied-volatility-index-rank"]) * 100),
          ivPercentile: Math.round(num(item["implied-volatility-percentile"]) * 100),
          hv30:         Math.round(num(item["hv-30-day"])  * 100 * 100) / 100,
          hv60:         Math.round(num(item["hv-60-day"])  * 100 * 100) / 100,
          hv90:         Math.round(num(item["hv-90-day"])  * 100 * 100) / 100,
        };
        metricsCache.set(sym, { data: metrics, exp: now + METRICS_TTL });
        result.set(sym, metrics);
      }
    } catch (err) {
      console.warn("[TT] getMarketMetrics chunk failed:", (err as Error)?.message ?? err);
    }
  }
  return result;
}

// ─── Positions ────────────────────────────────────────────────────────────

export interface TtRawPosition {
  symbol: string;
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
}

export async function getRawPositions(): Promise<TtRawPosition[]> {
  const json = await ttGet<TastytradeItemsResponse<any>>(`/accounts/${ACCOUNT}/positions`);
  return (json.data?.items ?? []).map((item: any) => ({
    symbol: (item.symbol as string) ?? "",
    instrumentType: (item["instrument-type"] as string) ?? "",
    underlying: (item["underlying-symbol"] as string) ?? "",
    quantity: num(item.quantity),
    direction: (item["quantity-direction"] as "Long" | "Short") ?? "Long",
    openPrice: num(item["average-open-price"]),
    currentPrice: num(item["close-price"]),
    multiplier: num(item.multiplier) || 100,
    costEffect: (item["cost-effect"] as "Debit" | "Credit") ?? "Debit",
    expiresAt: (item["expires-at"] as string) ?? null,
    createdAt: (item["created-at"] as string) ?? "",
  }));
}

// ─── Balances ─────────────────────────────────────────────────────────────

export interface TtBalances {
  netLiquidatingValue: number;
  optionBuyingPower: number;
  cashBalance: number;
  realizedDayGain: number;
  unrealizedDayGain: number;
}

export async function getBalances(): Promise<TtBalances> {
  const json = await ttGet<TastytradeDataResponse<Record<string, unknown>>>(`/accounts/${ACCOUNT}/balances`);
  const d = json.data ?? {};
  return {
    netLiquidatingValue: num(d["net-liquidating-value"]),
    optionBuyingPower: num(d["derivative-buying-power"] ?? d["option-buying-power"]),
    cashBalance: num(d["cash-balance"]),
    realizedDayGain: num(d["realized-day-gain"]),
    unrealizedDayGain: num(d["unrealized-day-gain"]),
  };
}
