/**
 * Polygon.io market data adapter
 * Replaces Yahoo Finance for the screener universe.
 * Keeps Yahoo Finance as fallback for per-stock fundamentals
 * (P/E, EPS, beta, dividends) since those require $199/mo on Polygon.
 *
 * Required plan: Starter ($29/mo) — needs Snapshot + Reference Data.
 * Key env var: POLYGON_API_KEY
 */

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

// ─── In-memory caches ─────────────────────────────────────────────────────────

interface Cache<T> { data: T; at: number }

const snapCache:   Cache<PolygonSnapshot[]>  = { data: [], at: 0 };
const refCache:    Cache<Map<string,PolygonTickerRef>> = { data: new Map(), at: 0 };

const SNAP_TTL = 15 * 60 * 1000;   // 15 min
const REF_TTL  = 12 * 60 * 60 * 1000; // 12 hours

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

export async function getPolygonBars(
  symbol: string,
  days: number = 90
): Promise<{ date: string; open: number; high: number; low: number; close: number; volume: number }[]> {
  const to   = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fmt  = (d: Date) => d.toISOString().slice(0, 10);

  const url = `${BASE}/v2/aggs/ticker/${symbol}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=300`;
  const json = await polyFetch(url);

  return (json.results ?? []).map((bar: any) => ({
    date:   new Date(bar.t).toISOString().slice(0, 10),
    open:   bar.o,
    high:   bar.h,
    low:    bar.l,
    close:  bar.c,
    volume: bar.v,
  }));
}

// ─── RSI via Polygon technical indicators ─────────────────────────────────────

export async function getPolygonRSI(symbol: string): Promise<number> {
  try {
    const url  = `${BASE}/v1/indicators/rsi/${symbol}?timespan=day&window=14&series_type=close&limit=1`;
    const json = await polyFetch(url);
    return json.results?.values?.[0]?.value ?? 50;
  } catch {
    return 50;
  }
}

// ─── MACD via Polygon technical indicators ────────────────────────────────────

export async function getPolygonMACD(symbol: string): Promise<{ histogram: number }> {
  try {
    const url  = `${BASE}/v1/indicators/macd/${symbol}?timespan=day&limit=1`;
    const json = await polyFetch(url);
    const v    = json.results?.values?.[0];
    return { histogram: (v?.value ?? 0) - (v?.signal ?? 0) };
  } catch {
    return { histogram: 0 };
  }
}

// ─── Single ticker snapshot ───────────────────────────────────────────────────

export async function getPolygonSnapshot(symbol: string): Promise<PolygonSnapshot | null> {
  try {
    const json = await polyFetch(`${BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);
    return json.ticker ?? null;
  } catch {
    return null;
  }
}
