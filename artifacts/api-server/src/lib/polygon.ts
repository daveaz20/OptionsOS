/**
 * Polygon.io market data adapter
 * Replaces Yahoo Finance for the screener universe.
 * Keeps Yahoo Finance as fallback for per-stock fundamentals
 * (P/E, EPS, beta, dividends) since those require $199/mo on Polygon.
 *
 * Required plan: Starter ($29/mo) — needs Snapshot + Reference Data.
 * Key env var: POLYGON_API_KEY
 */

import type { EtfCategory } from "./market-data.js";

const BASE = "https://api.polygon.io";
const KEY  = () => process.env.POLYGON_API_KEY ?? "";

export function isPolygonEnabled(): boolean {
  return Boolean(process.env.POLYGON_API_KEY);
}

// ─── Types ────────────────────────────────────────────────────────────────────

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
  type:             string;  // "CS" = common stock, "ETF", "ADRC", etc.
  active:           boolean;
  currency_name:    string;
}

export interface PolygonETFRef {
  ticker:      string;
  name:        string;
  type:        "ETF" | "ETV";
  etfCategory: EtfCategory;
}

// ─── In-memory caches ─────────────────────────────────────────────────────────

interface Cache<T> { data: T; at: number }

const snapCache: Cache<PolygonSnapshot[]>            = { data: [], at: 0 };
const refCache:  Cache<Map<string, PolygonTickerRef>> = { data: new Map(), at: 0 };
const etfCache:  Cache<PolygonETFRef[]>              = { data: [], at: 0 };
const barsCache  = new Map<string, Cache<PolygonBar[]>>();

const SNAP_TTL = 15 * 60 * 1000;      // 15 min
const REF_TTL  = 12 * 60 * 60 * 1000; // 12 hours
const ETF_TTL  = 12 * 60 * 60 * 1000; // 12 hours — ETF universe changes slowly
const BARS_TTL = 30 * 60 * 1000;      // 30 min (matches getPriceHistory)

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function polyFetch(url: string): Promise<any> {
  const sep = url.includes("?") ? "&" : "?";
  const res  = await fetch(`${url}${sep}apiKey=${KEY()}`);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${res.statusText} — ${url}`);
  return res.json();
}

// Paginate through all pages of a Polygon endpoint
async function fetchAllPages<T>(
  firstUrl: string,
  resultsKey: string
): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = firstUrl;
  let pages = 0;
  while (url && pages < 40) {          // safety cap at 40 pages (~40 000 tickers)
    const json = await polyFetch(url);
    const items: T[] = json[resultsKey] ?? [];
    all.push(...items);
    url = json.next_url ?? null;
    pages++;
  }
  return all;
}

// ─── Reference tickers (company names, type filter) ──────────────────────────

export async function getPolygonTickers(): Promise<Map<string, PolygonTickerRef>> {
  const now = Date.now();
  if (refCache.data.size > 0 && now - refCache.at < REF_TTL) return refCache.data;

  console.log("[polygon] fetching reference tickers…");
  const items = await fetchAllPages<PolygonTickerRef>(
    `${BASE}/v3/reference/tickers?market=stocks&active=true&limit=1000`,
    "results"
  );

  const map = new Map<string, PolygonTickerRef>();
  for (const t of items) {
    if (t.locale === "us" && t.currency_name === "usd") {
      map.set(t.ticker, t);
    }
  }
  refCache.data = map;
  refCache.at   = now;
  console.log(`[polygon] loaded ${map.size} US tickers`);
  return map;
}

// ─── Snapshot (all US stocks, price + volume) ─────────────────────────────────

export async function getPolygonSnapshots(): Promise<PolygonSnapshot[]> {
  const now = Date.now();
  if (snapCache.data.length > 0 && now - snapCache.at < SNAP_TTL) {
    return snapCache.data;
  }

  console.log("[polygon] fetching all-stock snapshots…");
  const items = await fetchAllPages<any>(
    `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false`,
    "tickers"
  );

  // Only return snaps that have actual day data (market was open)
  const snaps: PolygonSnapshot[] = items.filter(
    (s: any) => s.day && s.day.c > 0
  );

  snapCache.data = snaps;
  snapCache.at   = now;
  console.log(`[polygon] loaded snapshots for ${snaps.length} tickers`);
  return snaps;
}

// ─── Per-ticker historical bars (for technicals) ──────────────────────────────

export interface PolygonBar {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

export async function getPolygonBars(symbol: string, days = 90): Promise<PolygonBar[]> {
  const cacheKey = `${symbol}:${days}`;
  const now = Date.now();
  const hit = barsCache.get(cacheKey);
  if (hit && now - hit.at < BARS_TTL) return hit.data;

  const to   = new Date();
  const from = new Date(now - days * 24 * 60 * 60 * 1000);
  const fmt  = (d: Date) => d.toISOString().slice(0, 10);

  // limit=600 safely covers 580 calendar days (~414 trading days)
  const url  = `${BASE}/v2/aggs/ticker/${symbol}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=600`;
  const json = await polyFetch(url);

  const bars: PolygonBar[] = (json.results ?? []).map((bar: any) => ({
    date:   new Date(bar.t).toISOString().slice(0, 10),
    open:   bar.o,
    high:   bar.h,
    low:    bar.l,
    close:  bar.c,
    volume: bar.v,
  }));

  barsCache.set(cacheKey, { data: bars, at: now });
  return bars;
}

// ─── Last trading date + EOD grouped bars ────────────────────────────────────

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
  return new Date(year, month - 1, day);
}

function isUSMarketHoliday(date: Date): boolean {
  const y   = date.getFullYear();
  const mo  = date.getMonth() + 1; // 1-based
  const d   = date.getDate();

  const nthWeekday = (year: number, month: number, weekday: number, n: number) => {
    const first = new Date(year, month - 1, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  };
  const lastWeekday = (year: number, month: number, weekday: number) => {
    const last = new Date(year, month, 0);
    return last.getDate() - ((last.getDay() - weekday + 7) % 7);
  };
  // Observed date for fixed holidays when they fall on a weekend
  const observedMatch = (fixedMo: number, fixedD: number) => {
    const dow = new Date(y, fixedMo - 1, fixedD).getDay();
    if (dow === 6) return mo === fixedMo && d === fixedD - 1; // Sat → Fri
    if (dow === 0) return mo === fixedMo && d === fixedD + 1; // Sun → Mon
    return mo === fixedMo && d === fixedD;
  };

  if (observedMatch(1, 1)) return true;                             // New Year's Day
  if (mo === 1 && d === nthWeekday(y, 1, 1, 3)) return true;       // MLK Day
  if (mo === 2 && d === nthWeekday(y, 2, 1, 3)) return true;       // Presidents Day
  const easter    = getEaster(y);
  const goodFri   = new Date(easter.getTime() - 2 * 86_400_000);
  if (mo === goodFri.getMonth() + 1 && d === goodFri.getDate()) return true; // Good Friday
  if (mo === 5 && d === lastWeekday(y, 5, 1)) return true;         // Memorial Day
  if (observedMatch(6, 19)) return true;                            // Juneteenth
  if (observedMatch(7, 4)) return true;                             // Independence Day
  if (mo === 9 && d === nthWeekday(y, 9, 1, 1)) return true;       // Labor Day
  if (mo === 11 && d === nthWeekday(y, 11, 4, 4)) return true;     // Thanksgiving
  if (observedMatch(12, 25)) return true;                           // Christmas
  return false;
}

export function getLastTradingDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1); // start from yesterday
  for (let i = 0; i < 10; i++) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !isUSMarketHoliday(d)) {
      return d.toISOString().slice(0, 10);
    }
    d.setDate(d.getDate() - 1);
  }
  // Fallback: 3 days ago (should never reach here)
  const fallback = new Date();
  fallback.setDate(fallback.getDate() - 3);
  return fallback.toISOString().slice(0, 10);
}

export interface EodBar { open: number; high: number; low: number; close: number; volume: number; vwap: number }

export async function getGroupedDailyBars(date: string): Promise<Map<string, EodBar>> {
  try {
    const url  = `${BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`;
    const json = await polyFetch(url);
    const map  = new Map<string, EodBar>();
    for (const r of (json.results ?? [])) {
      if (!r.T || !r.c || r.c < 2 || !r.v || r.v < 100_000) continue;
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
    return map;
  } catch (err) {
    console.error("[polygon] getGroupedDailyBars error (non-fatal):", (err as Error)?.message ?? err);
    return new Map();
  }
}

// ─── ETF reference data + classification ──────────────────────────────────────

/**
 * Classify an ETF into a scoring category based on its name.
 * Priority: single-stock → bear → bull/leveraged → sector
 */
export function classifyETF(ticker: string, name: string): EtfCategory {
  const n = name.toLowerCase();

  // Single-stock leveraged/directional products contain a specific company name or ticker
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

  // Bear / inverse / short direction — includes Direxion daily bear products
  if (/\bshort\b|inverse|bear|\-[123]x|ultrashort|ultra short|proshort|direxion.*bear|daily bear/.test(n)) {
    return "leveraged-bear";
  }

  // Bull / leveraged (non-inverse) — includes Direxion daily bull products
  if (/\b[23]x\b|[23]×|leveraged|ultra\b|ultrapro|daily bull|daily long|bull\b|direxion/.test(n)) {
    return "leveraged-bull";
  }

  return "sector";
}

/**
 * Fetch all ETF and ETV reference tickers from Polygon.
 * Price/volume filtering is done in the screener loop using snapshot data.
 */
export async function getPolygonETFs(): Promise<PolygonETFRef[]> {
  const now = Date.now();
  if (etfCache.data.length > 0 && now - etfCache.at < ETF_TTL) return etfCache.data;

  console.log("[polygon] fetching ETF/ETV/ETN reference data…");

  const [etfItems, etvItems, etnItems] = await Promise.all([
    fetchAllPages<PolygonTickerRef>(
      `${BASE}/v3/reference/tickers?type=ETF&market=stocks&active=true&limit=1000`,
      "results"
    ).catch(() => [] as PolygonTickerRef[]),
    fetchAllPages<PolygonTickerRef>(
      `${BASE}/v3/reference/tickers?type=ETV&market=stocks&active=true&limit=1000`,
      "results"
    ).catch(() => [] as PolygonTickerRef[]),
    // ETN (exchange-traded notes) captures VelocityShares, Credit Suisse, etc.
    fetchAllPages<PolygonTickerRef>(
      `${BASE}/v3/reference/tickers?type=ETN&market=stocks&active=true&limit=1000`,
      "results"
    ).catch(() => [] as PolygonTickerRef[]),
  ]);

  const all = [...etfItems, ...etvItems, ...etnItems].filter(
    t => t.locale === "us" && t.currency_name === "usd" && t.active !== false
  );

  const result: PolygonETFRef[] = all.map(t => ({
    ticker:      t.ticker,
    name:        t.name,
    type:        t.type as "ETF" | "ETV" | "ETN",
    etfCategory: classifyETF(t.ticker, t.name),
  }));

  etfCache.data = result;
  etfCache.at   = now;
  console.log(`[polygon] ${result.length} ETFs loaded (${result.filter(e => e.type === "ETV").length} leveraged/ETV)`);
  return result;
}
