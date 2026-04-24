/**
 * Polygon.io market data adapter — full rewrite
 *
 * Required plan: Starter ($29/mo) — Snapshot + Reference Data + Aggregates
 * Key env var: POLYGON_API_KEY
 *
 * Design:
 *  - All fetches have a 15s timeout and retry up to 3× with exponential backoff
 *  - Rate-limit (429) responses trigger a longer backoff before retrying
 *  - Each data type has its own in-memory cache with sensible TTLs
 *  - EOD fallback tries the last 5 trading-day candidates so weekends/holidays work
 */

import type { EtfCategory } from "./market-data.js";
import { loadServerEnvIntoProcess } from "./server-env.js";

loadServerEnvIntoProcess();

const BASE = "https://api.polygon.io";
const key  = () => process.env.POLYGON_API_KEY ?? "";

export function isPolygonEnabled(): boolean {
  return Boolean(process.env.POLYGON_API_KEY);
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PolygonSnapshot {
  ticker:           string;
  todaysChangePerc: number;
  todaysChange:     number;
  updated:          number;
  day:     { o: number; h: number; l: number; c: number; v: number; vw: number };
  prevDay: { o: number; h: number; l: number; c: number; v: number; vw: number };
  lastTrade?: { p: number; s: number; t: number };
  lastQuote?: { P: number; S: number; p: number; s: number; t: number };
  min?:    { o: number; h: number; l: number; c: number; v: number; vw: number };
}

export interface PolygonTickerRef {
  ticker:           string;
  name:             string;
  market:           string;
  locale:           string;
  primary_exchange: string;
  type:             string;
  active:           boolean;
  currency_name:    string;
}

export interface PolygonETFRef {
  ticker:      string;
  name:        string;
  type:        "ETF" | "ETV" | "ETN";
  etfCategory: EtfCategory;
}

export interface PolygonBar {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

export interface EodBar {
  open: number; high: number; low: number; close: number; volume: number; vwap: number;
}

// ─── Fetch with timeout + retry ────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES      = 3;

async function polyFetch(url: string, attempt = 0): Promise<any> {
  const sep      = url.includes("?") ? "&" : "?";
  const fullUrl  = `${url}${sep}apiKey=${key()}`;
  const controller = new AbortController();
  const timer    = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(fullUrl, { signal: controller.signal });
  } catch (err: any) {
    clearTimeout(timer);
    if (attempt < MAX_RETRIES) {
      const delay = 500 * 2 ** attempt;
      console.warn(`[polygon] fetch error (attempt ${attempt + 1}), retrying in ${delay}ms — ${url} — ${err.message}`);
      await sleep(delay);
      return polyFetch(url, attempt + 1);
    }
    throw new Error(`[polygon] fetch failed after ${MAX_RETRIES + 1} attempts — ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    if (attempt < MAX_RETRIES) {
      const delay = 2000 * 2 ** attempt; // 2s, 4s, 8s
      console.warn(`[polygon] rate-limited (429), retrying in ${delay}ms — ${url}`);
      await sleep(delay);
      return polyFetch(url, attempt + 1);
    }
    throw new Error(`[polygon] rate limit (429) persists after ${MAX_RETRIES + 1} attempts — ${url}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if ((res.status === 500 || res.status === 503) && attempt < MAX_RETRIES) {
      const delay = 1000 * 2 ** attempt;
      console.warn(`[polygon] ${res.status} server error, retrying in ${delay}ms — ${url}`);
      await sleep(delay);
      return polyFetch(url, attempt + 1);
    }
    throw new Error(`[polygon] HTTP ${res.status} — ${url} — ${body.slice(0, 200)}`);
  }

  return res.json();
}

async function fetchAllPages<T>(firstUrl: string, resultsKey: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = firstUrl;
  let pages = 0;

  while (url && pages < 60) {
    const json   = await polyFetch(url);
    const items  = (json[resultsKey] ?? []) as T[];
    all.push(...items);
    // next_url already includes the apiKey so we must strip it before re-adding
    const next = json.next_url as string | undefined;
    if (!next) break;
    // Remove any existing apiKey param — polyFetch re-appends it
    url = next.replace(/[?&]apiKey=[^&]*/g, "");
    pages++;
  }

  return all;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Caches ────────────────────────────────────────────────────────────────────

interface Cache<T> { data: T; at: number }

const snapCache: Cache<PolygonSnapshot[]>             = { data: [], at: 0 };
const refCache:  Cache<Map<string, PolygonTickerRef>> = { data: new Map(), at: 0 };
const etfCache:  Cache<PolygonETFRef[]>               = { data: [], at: 0 };
const eodCache   = new Map<string, Cache<Map<string, EodBar>>>();
const barsCache  = new Map<string, Cache<PolygonBar[]>>();

const TTL_SNAPS = 15 * 60 * 1000;
const TTL_REF   = 12 * 60 * 60 * 1000;
const TTL_ETF   = 12 * 60 * 60 * 1000;
const TTL_EOD   = 60 * 60 * 1000;
const TTL_BARS  = 30 * 60 * 1000;

// ─── Reference tickers ─────────────────────────────────────────────────────────

export async function getPolygonTickers(): Promise<Map<string, PolygonTickerRef>> {
  const now = Date.now();
  if (refCache.data.size > 0 && now - refCache.at < TTL_REF) return refCache.data;

  if (!key()) {
    console.warn("[polygon] POLYGON_API_KEY not set — skipping reference ticker fetch");
    return new Map();
  }

  console.log("[polygon] fetching reference tickers…");
  try {
    const items = await fetchAllPages<PolygonTickerRef>(
      `${BASE}/v3/reference/tickers?market=stocks&active=true&limit=1000`,
      "results",
    );

    const map = new Map<string, PolygonTickerRef>();
    for (const t of items) {
      if (t.locale === "us" && t.currency_name === "usd") map.set(t.ticker, t);
    }
    refCache.data = map;
    refCache.at   = now;
    console.log(`[polygon] ${map.size} US reference tickers loaded`);
    return map;
  } catch (err: any) {
    console.error("[polygon] reference ticker fetch failed:", err.message);
    return refCache.data.size > 0 ? refCache.data : new Map();
  }
}

// ─── All-market snapshot ────────────────────────────────────────────────────────

export async function getPolygonSnapshots(): Promise<PolygonSnapshot[]> {
  const now = Date.now();
  if (snapCache.data.length > 0 && now - snapCache.at < TTL_SNAPS) return snapCache.data;

  if (!key()) {
    console.warn("[polygon] POLYGON_API_KEY not set — skipping snapshot fetch");
    return [];
  }

  console.log("[polygon] fetching all-stock snapshots…");
  try {
    const items = await fetchAllPages<any>(
      `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false`,
      "tickers",
    );

    console.log(`[polygon] raw snapshot items: ${items.length}`);

    // Accept anything with a non-zero close in day OR prevDay — market-hours filter only
    const snaps: PolygonSnapshot[] = items.filter((s: any) => {
      const dayClose  = s.day?.c  ?? 0;
      const prevClose = s.prevDay?.c ?? 0;
      return dayClose > 0 || prevClose > 0;
    });

    snapCache.data = snaps;
    snapCache.at   = now;
    console.log(`[polygon] ${snaps.length} snapshots kept after filtering`);
    return snaps;
  } catch (err: any) {
    console.error("[polygon] snapshot fetch failed:", err.message);
    return snapCache.data.length > 0 ? snapCache.data : [];
  }
}

// ─── Historical bars per ticker ─────────────────────────────────────────────────

export async function getPolygonBars(symbol: string, days = 90): Promise<PolygonBar[]> {
  const cacheKey = `${symbol}:${days}`;
  const now = Date.now();
  const hit = barsCache.get(cacheKey);
  if (hit && now - hit.at < TTL_BARS) return hit.data;

  const to   = new Date(now);
  const from = new Date(now - days * 24 * 60 * 60 * 1000);
  const fmt  = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const json = await polyFetch(
      `${BASE}/v2/aggs/ticker/${symbol}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=600`,
    );

    const bars: PolygonBar[] = (json.results ?? []).map((b: any) => ({
      date:   new Date(b.t).toISOString().slice(0, 10),
      open:   b.o,
      high:   b.h,
      low:    b.l,
      close:  b.c,
      volume: b.v,
    }));

    barsCache.set(cacheKey, { data: bars, at: now });
    return bars;
  } catch (err: any) {
    console.error(`[polygon] bars failed for ${symbol}:`, err.message);
    return barsCache.get(cacheKey)?.data ?? [];
  }
}

export function chartPeriodToPolygonDays(period: string): number {
  switch (period) {
    case "1D": return 5;
    case "1W": return 14;
    case "1M": return 45;
    case "3M": return 120;
    case "6M": return 220;
    case "1Y": return 420;
    case "2Y": return 760;
    default: return 90;
  }
}

// ─── Trading calendar ───────────────────────────────────────────────────────────

function getEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isUSMarketHoliday(date: Date): boolean {
  const y  = date.getUTCFullYear();
  const mo = date.getUTCMonth() + 1;
  const d  = date.getUTCDate();
  const dow = date.getUTCDay();

  const nthWeekday = (year: number, month: number, weekday: number, n: number) => {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  };
  const lastMonday = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month, 0));
    return last.getUTCDate() - ((last.getUTCDay() - 1 + 7) % 7);
  };

  // Fixed holiday observed date: Sat→Fri, Sun→Mon
  const observed = (fMo: number, fD: number) => {
    const fixedDow = new Date(Date.UTC(y, fMo - 1, fD)).getUTCDay();
    if (fixedDow === 6) return mo === fMo && d === fD - 1;
    if (fixedDow === 0) return mo === fMo && d === fD + 1;
    return mo === fMo && d === fD;
  };

  if (observed(1, 1))  return true; // New Year's Day
  if (mo === 1 && d === nthWeekday(y, 1, 1, 3))  return true; // MLK Day
  if (mo === 2 && d === nthWeekday(y, 2, 1, 3))  return true; // Presidents Day

  const easter   = getEaster(y);
  const goodFri  = new Date(easter.getTime() - 2 * 86_400_000);
  if (mo === goodFri.getUTCMonth() + 1 && d === goodFri.getUTCDate()) return true; // Good Friday

  if (mo === 5 && d === lastMonday(y, 5))         return true; // Memorial Day
  if (observed(6, 19))                            return true; // Juneteenth
  if (observed(7, 4))                             return true; // Independence Day
  if (mo === 9 && d === nthWeekday(y, 9, 1, 1))   return true; // Labor Day
  if (mo === 11 && d === nthWeekday(y, 11, 4, 4)) return true; // Thanksgiving
  if (observed(12, 25))                           return true; // Christmas

  return false;
}

function isTradingDay(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6 && !isUSMarketHoliday(date);
}

/** Returns the most recent completed trading date (never today — intraday data uses snapshots). */
export function getLastTradingDate(): string {
  const d = new Date();
  // Start from yesterday
  d.setUTCDate(d.getUTCDate() - 1);
  for (let i = 0; i < 10; i++) {
    if (isTradingDay(d)) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  // Fallback: 3 calendar days ago
  const fb = new Date();
  fb.setUTCDate(fb.getUTCDate() - 3);
  return fb.toISOString().slice(0, 10);
}

/** Returns up to `count` recent trading dates, newest first. */
function recentTradingDates(count: number): string[] {
  const dates: string[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (dates.length < count) {
    if (isTradingDay(d)) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates;
}

// ─── EOD grouped daily bars ─────────────────────────────────────────────────────

export async function getGroupedDailyBars(date: string): Promise<Map<string, EodBar>> {
  const now = Date.now();
  const hit = eodCache.get(date);
  if (hit && now - hit.at < TTL_EOD) return hit.data;

  try {
    const json = await polyFetch(
      `${BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
    );

    const map = new Map<string, EodBar>();
    for (const r of (json.results ?? [])) {
      if (!r.T || !r.c || r.c < 1 || !r.v || r.v < 50_000) continue;
      map.set(r.T as string, {
        open:   r.o ?? r.c,
        high:   r.h ?? r.c,
        low:    r.l ?? r.c,
        close:  r.c,
        volume: r.v,
        vwap:   r.vw ?? r.c,
      });
    }

    console.log(`[polygon] EOD grouped bars for ${date}: ${map.size} tickers`);
    eodCache.set(date, { data: map, at: now });
    return map;
  } catch (err: any) {
    console.error(`[polygon] getGroupedDailyBars(${date}) failed:`, err.message);
    return new Map();
  }
}

/**
 * Returns grouped EOD bars for the most recent available trading date.
 * Tries up to 5 recent dates so weekends/holidays automatically resolve.
 */
export async function getLatestEodBars(): Promise<{ date: string; bars: Map<string, EodBar> }> {
  const candidates = recentTradingDates(5);
  for (const date of candidates) {
    const bars = await getGroupedDailyBars(date);
    if (bars.size > 100) {
      console.log(`[polygon] using EOD bars from ${date} (${bars.size} tickers)`);
      return { date, bars };
    }
    console.warn(`[polygon] EOD bars for ${date} returned only ${bars.size} tickers, trying earlier date`);
  }
  console.error("[polygon] could not find any recent EOD bar data");
  return { date: candidates[0]!, bars: new Map() };
}

// ─── ETF classification ─────────────────────────────────────────────────────────

export function classifyETF(ticker: string, name: string): EtfCategory {
  const n = name.toLowerCase();

  const SINGLE_STOCK_TERMS = [
    "nvidia","nvda","tesla","tsla","apple","aapl","microsoft","msft",
    "amazon","amzn","alphabet","googl","google","meta","facebook",
    "netflix","nflx","coinbase","coin","palantir","pltr","robinhood","hood",
    "jpmorgan","jpm","goldman","gs","exxon","xom","chevron","cvx",
    "pfizer","pfe","moderna","mrna","salesforce","crm","disney","dis",
    "shopify","shop","airbnb","abnb","snowflake","snow","uber","lyft",
    "berkshire","arm holdings","arm ","nike ","nike,","ford ","ford,","gm ",
  ];
  if (SINGLE_STOCK_TERMS.some(t => n.includes(t))) return "leveraged-single";

  if (/\bshort\b|inverse|bear|\-[123]x|ultrashort|ultra short|proshort|direxion.*bear|daily bear/.test(n)) {
    return "leveraged-bear";
  }
  if (/\b[23]x\b|[23]×|leveraged|ultra\b|ultrapro|daily bull|daily long|bull\b|direxion/.test(n)) {
    return "leveraged-bull";
  }
  return "sector";
}

export async function getPolygonETFs(): Promise<PolygonETFRef[]> {
  const now = Date.now();
  if (etfCache.data.length > 0 && now - etfCache.at < TTL_ETF) return etfCache.data;

  if (!key()) {
    console.warn("[polygon] POLYGON_API_KEY not set — skipping ETF fetch");
    return [];
  }

  console.log("[polygon] fetching ETF/ETV/ETN reference data…");
  try {
    const [etfItems, etvItems, etnItems] = await Promise.all([
      fetchAllPages<PolygonTickerRef>(
        `${BASE}/v3/reference/tickers?type=ETF&market=stocks&active=true&limit=1000`, "results",
      ).catch(() => [] as PolygonTickerRef[]),
      fetchAllPages<PolygonTickerRef>(
        `${BASE}/v3/reference/tickers?type=ETV&market=stocks&active=true&limit=1000`, "results",
      ).catch(() => [] as PolygonTickerRef[]),
      fetchAllPages<PolygonTickerRef>(
        `${BASE}/v3/reference/tickers?type=ETN&market=stocks&active=true&limit=1000`, "results",
      ).catch(() => [] as PolygonTickerRef[]),
    ]);

    const all = [...etfItems, ...etvItems, ...etnItems].filter(
      t => t.locale === "us" && t.currency_name === "usd" && t.active !== false,
    );

    const result: PolygonETFRef[] = all.map(t => ({
      ticker:      t.ticker,
      name:        t.name,
      type:        t.type as "ETF" | "ETV" | "ETN",
      etfCategory: classifyETF(t.ticker, t.name),
    }));

    etfCache.data = result;
    etfCache.at   = now;
    console.log(`[polygon] ${result.length} ETFs/ETVs/ETNs loaded`);
    return result;
  } catch (err: any) {
    console.error("[polygon] ETF fetch failed:", err.message);
    return etfCache.data.length > 0 ? etfCache.data : [];
  }
}

