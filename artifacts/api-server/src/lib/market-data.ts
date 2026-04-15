/**
 * Market Data Service
 * Primary: Yahoo Finance (live, no API key)
 * Future: Schwab API (swap in schwab.ts when credentials are ready)
 */

import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// In-memory cache to avoid hammering Yahoo Finance
interface CacheEntry<T> { data: T; expiresAt: number }
const cache = new Map<string, CacheEntry<unknown>>();

function getCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const QUOTE_TTL = 5 * 60 * 1000;      // 5 min
const HISTORY_TTL = 30 * 60 * 1000;   // 30 min
const OPTIONS_TTL = 15 * 60 * 1000;   // 15 min

// ─── Quote ────────────────────────────────────────────────────────────────────

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  sector: string;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  eps: number;
  pe: number;
  dividendYield: number;
  earningsDate: string;
  beta: number;
}

export async function getQuote(symbol: string): Promise<MarketQuote> {
  const key = `quote:${symbol}`;
  const cached = getCache<MarketQuote>(key);
  if (cached) return cached;

  const q = await yahooFinance.quote(symbol, {}, { validateResult: false });

  const data: MarketQuote = {
    symbol: q.symbol ?? symbol,
    name: q.longName ?? q.shortName ?? symbol,
    price: q.regularMarketPrice ?? 0,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    volume: q.regularMarketVolume ?? 0,
    avgVolume: q.averageDailyVolume3Month ?? q.regularMarketVolume ?? 0,
    marketCap: q.marketCap ?? 0,
    sector: (q as any).sector ?? "Equity",
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? 0,
    eps: q.epsTrailingTwelveMonths ?? 0,
    pe: q.trailingPE ?? 0,
    dividendYield: q.trailingAnnualDividendYield ?? 0,
    earningsDate: q.earningsTimestamp
      ? new Date(q.earningsTimestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "TBD",
    beta: (q as any).beta ?? 1,
  };

  // Enrich with summary detail for sector if not available
  if (data.sector === "Equity") {
    try {
      const summary = await yahooFinance.quoteSummary(symbol, { modules: ["assetProfile"] }, { validateResult: false });
      data.sector = summary.assetProfile?.sector ?? "Equity";
    } catch {}
  }

  setCache(key, data, QUOTE_TTL);
  return data;
}

export async function getQuotes(symbols: string[]): Promise<MarketQuote[]> {
  return Promise.all(symbols.map((s) => getQuote(s).catch(() => null as any))).then((r) => r.filter(Boolean));
}

// ─── Price History ─────────────────────────────────────────────────────────

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getPriceHistory(symbol: string, period: string): Promise<OHLCV[]> {
  const key = `history:${symbol}:${period}`;
  const cached = getCache<OHLCV[]>(key);
  if (cached) return cached;

  const { interval, period1 } = periodToYahoo(period);

  const result = await yahooFinance.chart(symbol, {
    interval,
    period1,
  }, { validateResult: false });

  const quotes = result.quotes ?? [];
  const data: OHLCV[] = quotes
    .filter((q) => q.open && q.high && q.low && q.close)
    .map((q) => ({
      date: new Date(q.date).toISOString().split("T")[0],
      open: round2(q.open!),
      high: round2(q.high!),
      low: round2(q.low!),
      close: round2(q.close!),
      volume: Math.round(q.volume ?? 0),
    }));

  setCache(key, data, HISTORY_TTL);
  return data;
}

function periodToYahoo(period: string): { interval: "1d" | "1wk" | "1mo"; period1: Date } {
  const ago = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };
  switch (period) {
    case "1D": return { interval: "1d", period1: ago(5) };
    case "1W": return { interval: "1d", period1: ago(30) };
    case "1M": return { interval: "1d", period1: ago(90) };
    case "3M": return { interval: "1d", period1: ago(180) };
    case "6M": return { interval: "1d", period1: ago(365) };
    case "1Y": return { interval: "1wk", period1: ago(730) };
    default:   return { interval: "1d", period1: ago(180) };
  }
}

// ─── Historical Volatility (for IV Rank proxy) ────────────────────────────

export async function getHistoricalVolatility(symbol: string): Promise<{ hv30: number; hv252: number; ivRank: number }> {
  const key = `hv:${symbol}`;
  const cached = getCache<{ hv30: number; hv252: number; ivRank: number }>(key);
  if (cached) return cached;

  const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const result = await yahooFinance.chart(symbol, { interval: "1d", period1: oneYearAgo }, { validateResult: false });
  const closes = (result.quotes ?? []).filter((q) => q.close).map((q) => q.close!);

  const hv = (window: number) => {
    if (closes.length < window + 1) return 0.25;
    const slice = closes.slice(-window - 1);
    const returns = slice.slice(1).map((c, i) => Math.log(c / slice[i]));
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance * 252);
  };

  const hv30 = hv(30);
  const hv252 = hv(252);

  // IV Rank proxy: where is HV30 relative to its 1-year range
  const windows: number[] = [];
  for (let i = 30; i < closes.length; i++) {
    const slice = closes.slice(i - 30, i);
    const returns = slice.slice(1).map((c, idx) => Math.log(c / slice[idx]));
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    windows.push(Math.sqrt(variance * 252));
  }

  const minHv = Math.min(...windows);
  const maxHv = Math.max(...windows);
  const ivRank = maxHv === minHv ? 50 : Math.round(((hv30 - minHv) / (maxHv - minHv)) * 100);

  const out = { hv30: round2(hv30 * 100), hv252: round2(hv252 * 100), ivRank: Math.max(0, Math.min(100, ivRank)) };
  setCache(key, out, OPTIONS_TTL);
  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function round2(n: number) { return Math.round(n * 100) / 100; }

// Default scanner universe — easily configurable
export const DEFAULT_UNIVERSE = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AMD","NFLX","CRM",
  "ORCL","ADBE","INTC","QCOM","AVGO","MU","NOW","SNOW","PLTR","MSTR",
  "JPM","BAC","GS","MS","V","MA","PYPL",
  "SPY","QQQ","IWM",
];
