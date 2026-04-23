/**
 * /api/screener — institutional-grade bulk screener endpoint
 *
 * When POLYGON_API_KEY is set (Starter $29/mo plan):
 *   → Uses Polygon.io Snapshot for the full US market universe (~5,000+ quality stocks)
 *   → Falls back to Yahoo Finance for per-stock fundamentals (P/E, beta, dividends)
 *
 * Without POLYGON_API_KEY:
 *   → Uses Yahoo Finance only (~477 curated symbols)
 *
 * Both modes use stale-while-revalidate caching.
 */

import { Router, type IRouter } from "express";
import {
  getQuotes,
  getPriceHistory,
  getHistoricalVolatility,
  computeHVFromBars,
  DEFAULT_UNIVERSE,
  ETF_MAP,
  ETF_UNIVERSE,
  getSectorForSymbol,
} from "../lib/market-data.js";
import { computeSignals } from "../lib/technical-analysis.js";
import { scanOpportunity } from "../lib/scanner.js";
import {
  isPolygonEnabled,
  getPolygonSnapshots,
  getPolygonTickers,
  getPolygonBars,
  getPolygonETFs,
  getLatestEodBars,
} from "../lib/polygon.js";
import {
  isTastytradeEnabled,
  isTastytradeAuthorized,
  getMarketMetrics,
} from "../lib/tastytrade.js";
import { db, screenerCacheTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

const SCREENER_TTL = 30 * 60 * 1000; // 30 min — data is 15-min delayed anyway

export interface ScreenerRow {
  symbol: string; name: string; price: number; change: number; changePercent: number;
  volume: number; avgVolume: number; relVol: number; marketCap: number; sector: string;
  beta: number; pe: number; forwardPE: number; eps: number; dividendYield: number;
  shortRatio: number; priceTarget: number; recommendation: number;
  fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number;
  pctFrom52High: number; pctFrom52Low: number; earningsDate: string;
  technicalStrength: number; rsi14: number; macdHistogram: number; ivRank: number;
  opportunityScore: number; technicalScore: number; ivScore: number; entryScore: number; momentumScore: number; vwapScore: number;
  setupType: string; recommendedOutlook: string;
  supportPrice: number; resistancePrice: number;
  liquidity: "Liquid" | "Illiquid";
  source: "polygon" | "yahoo" | "polygon-eod";
  isETF?: boolean;
  etfCategory?: "leveraged-bull" | "leveraged-bear" | "leveraged-single" | "sector";
  topStrategies?: Array<{
    id: string;
    name: string;
    fitScore: number;
    fitReason: string;
    tier: string;
    url: string;
  }>;
}

interface Cache { data: ScreenerRow[]; at: number; promise: Promise<void> | null }
const cache: Cache = { data: [], at: 0, promise: null };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns days until earningsDate string ("Apr 30, 2026"), or undefined if unknown/past */
function daysUntilEarnings(earningsDate: string): number | undefined {
  if (!earningsDate || earningsDate === "TBD") return undefined;
  try {
    const d = new Date(earningsDate);
    if (isNaN(d.getTime())) return undefined;
    const diff = Math.floor((d.getTime() - Date.now()) / 86_400_000);
    return diff >= 0 ? diff : undefined; // ignore past earnings
  } catch { return undefined; }
}

// ─── Yahoo Finance screener (original, ~477 symbols) ─────────────────────────

async function buildYahooData(): Promise<ScreenerRow[]> {
  const etfSymbols = ETF_UNIVERSE.map(e => e.symbol);
  const universe   = [...new Set([...DEFAULT_UNIVERSE, ...etfSymbols])];
  const quotes     = await getQuotes(universe);
  const rows: ScreenerRow[] = [];

  // Batch-fetch TT market metrics once (true IV rank from options history)
  let ttMetrics = new Map<string, import("../lib/tastytrade.js").TtMarketMetrics>();
  if (isTastytradeEnabled() && isTastytradeAuthorized()) {
    try {
      ttMetrics = await getMarketMetrics(quotes.map(q => q.symbol));
      console.log(`[screener] TT metrics fetched for ${ttMetrics.size}/${quotes.length} symbols`);
    } catch (err) {
      console.warn("[screener] TT metrics batch failed, falling back to HV proxy:", (err as Error)?.message ?? err);
    }
  }

  for (let i = 0; i < quotes.length; i += 25) {
    const batch   = quotes.slice(i, i + 25);
    const results = await Promise.allSettled(batch.map(async (q) => {
      const hi   = q.fiftyTwoWeekHigh || q.price;
      const lo   = q.fiftyTwoWeekLow  || q.price;
      const base = {
        symbol: q.symbol, name: q.name, price: q.price,
        change: r2(q.change), changePercent: r2(q.changePercent),
        volume: q.volume, avgVolume: q.avgVolume, relVol: r2(q.relVol),
        marketCap: q.marketCap, sector: q.sector,
        beta: r2(q.beta), pe: r2(q.pe), forwardPE: r2(q.forwardPE),
        eps: r2(q.eps), dividendYield: r2(q.dividendYield * 100),
        shortRatio: r2(q.shortRatio), priceTarget: r2(q.priceTarget),
        recommendation: r2(q.recommendation),
        fiftyTwoWeekHigh: hi, fiftyTwoWeekLow: lo,
        pctFrom52High: r2(((q.price - hi) / hi) * 100),
        pctFrom52Low:  r2(((q.price - lo) / lo) * 100),
        earningsDate: q.earningsDate,
        liquidity: (q.avgVolume > 1_000_000 ? "Liquid" : "Illiquid") as ScreenerRow["liquidity"],
        source: "yahoo" as const,
      };
      try {
        const [history, hv] = await Promise.all([
          getPriceHistory(q.symbol, "TECH"),
          getHistoricalVolatility(q.symbol),
        ]);
        const sig    = computeSignals(history, q.price);
        const dte    = daysUntilEarnings(q.earningsDate);
        const etfCat = ETF_MAP.get(q.symbol);
        // Prefer TT's true IV rank (options-based) over HV-percentile proxy
        const tt     = ttMetrics.get(q.symbol);
        const ivRank = tt ? tt.ivRank : r2(hv.ivRank);
        const scan   = scanOpportunity(sig, ivRank, q.price, q.changePercent, dte,
          undefined, undefined, etfCat ? { isETF: true, etfCategory: etfCat } : undefined);
        return {
          ...base,
          technicalStrength: Math.round(sig.strength),
          rsi14: r2(sig.rsi14), macdHistogram: r2(sig.macd.histogram),
          ivRank,
          opportunityScore: scan?.opportunityScore ?? 40,
          technicalScore: scan?.technicalScore ?? 0,
          ivScore: scan?.ivScore ?? 0,
          entryScore: scan?.entryScore ?? 0,
          momentumScore: scan?.momentumScore ?? 0,
          vwapScore: scan?.vwapScore ?? 0,
          setupType: scan?.setupType ?? "long_call",
          recommendedOutlook: scan?.recommendedOutlook ?? "neutral",
          supportPrice: sig.support, resistancePrice: sig.resistance,
          topStrategies: scan?.topStrategies ?? [],
          ...(etfCat ? { isETF: true, etfCategory: etfCat } : {}),
        } satisfies ScreenerRow;
      } catch (err) {
        console.error(`[screener] technicals failed for ${q.symbol}:`, (err as Error)?.message ?? err);
        return {
          ...base,
          technicalStrength: 5, rsi14: 50, macdHistogram: 0, ivRank: 30,
          opportunityScore: 25, technicalScore: 0, ivScore: 0, entryScore: 0, momentumScore: 0, vwapScore: 0,
          setupType: "long_call", recommendedOutlook: "neutral",
          supportPrice: r2(q.price * 0.94), resistancePrice: r2(q.price * 1.06),
        } satisfies ScreenerRow;
      }
    }));
    for (const r of results) {
      if (r.status === "fulfilled") rows.push(r.value);
    }
  }
  return rows;
}

// ─── Polygon screener (full US market, ~5 000+ quality stocks) ───────────────

async function buildPolygonData(): Promise<ScreenerRow[]> {
  console.log("[screener] building from Polygon.io…");

  const [rawSnaps, tickerMap, etfRefs] = await Promise.all([
    getPolygonSnapshots(),
    getPolygonTickers(),
    getPolygonETFs(),
  ]);

  let snaps = rawSnaps;
  let isEod = false;

  if (snaps.length === 0) {
    console.log("[polygon] snapshots empty (market closed?), falling back to latest EOD bars");
    const { date, bars: eodBars } = await getLatestEodBars();
    console.log(`[polygon] EOD fallback using ${date} — ${eodBars.size} tickers`);
    isEod = true;
    snaps = [...eodBars.entries()].map(([ticker, bar]) => ({
      ticker,
      todaysChangePerc: 0,
      todaysChange: 0,
      updated: 0,
      day:     { o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume, vw: bar.vwap },
      prevDay: { o: 0, h: 0, l: 0, c: 0, v: 0, vw: 0 },
    }));
  }

  // Build fast-lookup map: ticker → ETF classification
  const etfMap = new Map(etfRefs.map(e => [e.ticker, e]));

  // Filter: CS/ADRC stocks ($2+, 100k+ vol) OR known ETFs ($2+, 500k+ vol for options liquidity)
  const VALID_TYPES = new Set(["CS", "ADRC"]);
  const filtered = snaps.filter((s) => {
    const price = s.day?.c ?? s.lastTrade?.p ?? 0;
    const vol   = s.day?.v ?? 0;
    if (etfMap.has(s.ticker)) return price >= 2 && vol >= 100_000;
    const ref = tickerMap.get(s.ticker);
    if (!ref || !VALID_TYPES.has(ref.type)) return false;
    return price >= 2 && vol >= 100_000;
  });

  console.log(`[polygon] ${snaps.length} snaps → ${filtered.length} quality stocks`);

  // Fetch Yahoo Finance fundamentals for curated universe only (P/E, beta, etc.)
  const knownSet  = new Set(DEFAULT_UNIVERSE);
  const quotes    = await getQuotes(filtered.filter(s => knownSet.has(s.ticker)).map(s => s.ticker));
  const quoteMap  = new Map(quotes.map(q => [q.symbol, q]));

  const rows: ScreenerRow[] = [];

  // Batch-fetch TT market metrics once for the curated universe (true IV rank)
  let ttMetrics = new Map<string, import("../lib/tastytrade.js").TtMarketMetrics>();
  if (isTastytradeEnabled() && isTastytradeAuthorized()) {
    try {
      ttMetrics = await getMarketMetrics([...knownSet]);
      console.log(`[screener] TT metrics fetched for ${ttMetrics.size}/${knownSet.size} symbols`);
    } catch (err) {
      console.warn("[screener] TT metrics batch failed, falling back to HV proxy:", (err as Error)?.message ?? err);
    }
  }

  // Full technicals for ALL quality stocks — 15 concurrent, 500ms between batches
  for (let i = 0; i < filtered.length; i += 15) {
    const batch   = filtered.slice(i, i + 15);
    const results = await Promise.allSettled(batch.map(async (s) => {
      const q          = quoteMap.get(s.ticker);
      const ref        = tickerMap.get(s.ticker);
      const price      = s.day?.c ?? s.lastTrade?.p ?? q?.price ?? 0;
      const change     = s.todaysChange ?? q?.change ?? 0;
      const chPct      = s.todaysChangePerc ?? q?.changePercent ?? 0;
      const vol        = s.day?.v ?? q?.volume ?? 0;
      const prevVol    = s.prevDay?.v ?? vol;
      const relVol     = prevVol > 0 ? r2(vol / prevVol) : 1;
      const hi52       = q?.fiftyTwoWeekHigh  || price * 1.3;
      const lo52       = q?.fiftyTwoWeekLow   || price * 0.7;
      const dayVwap    = s.day?.vw    ?? 0;
      const prevDayVwap= s.prevDay?.vw ?? 0;

      const base = {
        symbol: s.ticker,
        name: ref?.name ?? q?.name ?? s.ticker,
        price: r2(price), change: r2(change), changePercent: r2(chPct),
        volume: vol, avgVolume: q?.avgVolume ?? prevVol, relVol,
        marketCap: q?.marketCap ?? 0,
        sector: q?.sector && q.sector !== "Equity" ? q.sector : getSectorForSymbol(s.ticker),
        beta: r2(q?.beta ?? 1), pe: r2(q?.pe ?? 0), forwardPE: r2(q?.forwardPE ?? 0),
        eps: r2(q?.eps ?? 0), dividendYield: r2((q?.dividendYield ?? 0) * 100),
        shortRatio: r2(q?.shortRatio ?? 0), priceTarget: r2(q?.priceTarget ?? 0),
        recommendation: r2(q?.recommendation ?? 3),
        fiftyTwoWeekHigh: hi52, fiftyTwoWeekLow: lo52,
        pctFrom52High: r2(((price - hi52) / hi52) * 100),
        pctFrom52Low:  r2(((price - lo52) / lo52) * 100),
        earningsDate: q?.earningsDate ?? "TBD",
        liquidity: (vol > 1_000_000 ? "Liquid" : "Illiquid") as ScreenerRow["liquidity"],
        source: (isEod ? "polygon-eod" : "polygon") as ScreenerRow["source"],
      };

      try {
        const history  = await getPolygonBars(s.ticker, 580);
        const hv       = computeHVFromBars(history);
        const sig      = computeSignals(history, price);
        const dte      = daysUntilEarnings(q?.earningsDate ?? "TBD");
        const etfRef   = etfMap.get(s.ticker);
        // Prefer TT's true IV rank (options-based) over HV-percentile proxy
        const tt       = ttMetrics.get(s.ticker);
        const ivRank   = tt ? tt.ivRank : r2(hv.ivRank);
        const scan     = scanOpportunity(sig, ivRank, price, chPct, dte, dayVwap, prevDayVwap,
          etfRef ? { isETF: true, etfCategory: etfRef.etfCategory } : undefined);
        return {
          ...base,
          technicalStrength: Math.round(sig.strength),
          rsi14: r2(sig.rsi14), macdHistogram: r2(sig.macd.histogram),
          ivRank,
          opportunityScore: scan.opportunityScore,
          technicalScore: scan.technicalScore,
          ivScore: scan.ivScore,
          entryScore: scan.entryScore,
          momentumScore: scan.momentumScore,
          vwapScore: scan.vwapScore,
          setupType: scan.setupType,
          recommendedOutlook: scan.recommendedOutlook,
          supportPrice: sig.support, resistancePrice: sig.resistance,
          topStrategies: scan.topStrategies,
          ...(etfRef ? { isETF: true, etfCategory: etfRef.etfCategory } : {}),
        } satisfies ScreenerRow;
      } catch (err) {
        console.error(`[screener] technicals failed for ${s.ticker}:`, (err as Error)?.message ?? err);
        return {
          ...base,
          technicalStrength: 5, rsi14: 50, macdHistogram: 0, ivRank: 30,
          opportunityScore: 25, technicalScore: 0, ivScore: 0, entryScore: 0, momentumScore: 0, vwapScore: 0,
          setupType: "long_call", recommendedOutlook: "neutral",
          supportPrice: r2(price * 0.94), resistancePrice: r2(price * 1.06),
        } satisfies ScreenerRow;
      }
    }));

    for (const r of results) {
      if (r.status === "fulfilled") rows.push(r.value);
    }

    if (i + 15 < filtered.length) await sleep(500);
  }

  console.log(`[polygon] built ${rows.length} rows with full technicals`);
  return rows;
}

// ─── DB persistence ───────────────────────────────────────────────────────────

const DB_CACHE_MAX_AGE = 4 * 60 * 60 * 1000; // serve stale DB data up to 4 hours old on cold start

async function persistToDb(rows: ScreenerRow[], source: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(screenerCacheTable);
      await tx.insert(screenerCacheTable).values({ payload: rows as unknown[], source });
    });
    console.log(`[screener] persisted ${rows.length} rows to DB`);
  } catch (err) {
    console.error("[screener] DB persist error (non-fatal):", err);
  }
}

async function loadFromDb(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(screenerCacheTable)
      .orderBy(desc(screenerCacheTable.cachedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return;
    const age = Date.now() - new Date(row.cachedAt).getTime();
    if (age > DB_CACHE_MAX_AGE) {
      console.log("[screener] DB cache too stale, skipping");
      return;
    }
    cache.data = row.payload as ScreenerRow[];
    cache.at   = new Date(row.cachedAt).getTime();
    console.log(`[screener] warmed ${cache.data.length} rows from DB (${Math.round(age / 60000)}m old)`);
  } catch (err) {
    console.error("[screener] DB load error (non-fatal):", err);
  }
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function doRefresh(): Promise<void> {
  try {
    const source = isPolygonEnabled() ? "polygon" : "yahoo";
    const rows   = isPolygonEnabled()
      ? await buildPolygonData()
      : await buildYahooData();
    cache.data = rows;
    cache.at   = Date.now();
    console.log(`[screener] cache updated: ${rows.length} rows (${source})`);
    persistToDb(rows, source);  // fire-and-forget — don't block response
  } catch (err) {
    console.error("[screener] refresh error", err);
  } finally {
    cache.promise = null;
  }
}

function triggerRefresh(): Promise<void> {
  if (!cache.promise) cache.promise = doRefresh();
  return cache.promise;
}

// On startup: warm from DB first, then kick off a fresh network fetch in background
loadFromDb().then(() => triggerRefresh().catch(() => {}));

router.get("/screener", async (req, res): Promise<void> => {
  if (cache.data.length === 0) await triggerRefresh();
  res.json(cache.data);
  if (Date.now() - cache.at > SCREENER_TTL) triggerRefresh().catch(() => {});
});

// Expose which data source is active
router.get("/screener/source", (_req, res) => {
  res.json({
    source: isPolygonEnabled() ? "polygon" : "yahoo",
    count: cache.data.length,
    cachedAt: cache.at,
  });
});

// ─── Accurate stats across the full universe ──────────────────────────────────

function isHighConviction(r: ScreenerRow): boolean {
  return r.opportunityScore >= 70
    && r.technicalScore >= 20
    && r.ivScore >= 12
    && r.entryScore >= 14
    && r.momentumScore >= 6;
}

router.get("/screener/stats", async (_req, res): Promise<void> => {
  if (cache.data.length === 0) await triggerRefresh();
  const rows = cache.data;

  const bull    = rows.filter(r => r.changePercent > 0).length;
  const bear    = rows.filter(r => r.changePercent < 0).length;
  const neutral = rows.filter(r => r.changePercent === 0).length;
  const total   = rows.length;

  // Rows with real technical analysis (not polygon-only defaults)
  const withTechnicals = rows.filter(r => r.opportunityScore !== 40);
  const highConviction = withTechnicals.filter(r => isHighConviction(r)).length;

  const ivVals = rows.map(r => r.ivRank).filter(v => v > 0);
  const avgIv  = ivVals.length > 0
    ? Math.round(ivVals.reduce((a, b) => a + b, 0) / ivVals.length)
    : 0;

  const bestScore  = rows.reduce((mx, r) => Math.max(mx, r.opportunityScore), 0);
  const setups60   = rows.filter(r => r.opportunityScore >= 60).length;

  const highIv = rows.filter(r => r.ivRank >= 50).length;

  // US market hours check (Eastern Time)
  const marketOpen = isUSMarketOpen();

  res.json({
    total,
    bull, bear, neutral,
    breadth: total > 0 ? Math.round((bull / total) * 100) : 50,
    highConviction,
    technicalsCount: withTechnicals.length,
    highIv,
    avgIv,
    bestScore,
    setups60,
    marketOpen,
    source: isPolygonEnabled() ? "polygon" : "yahoo",
    cachedAt: cache.at,
  });
});

function isUSMarketOpen(): boolean {
  try {
    const now = new Date();
    // Convert to Eastern Time
    const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const et = new Date(etStr);
    const day = et.getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;
    const totalMin = et.getHours() * 60 + et.getMinutes();
    return totalMin >= 9 * 60 + 30 && totalMin < 16 * 60;
  } catch {
    return false;
  }
}

function r2(n: number) { return Math.round(n * 100) / 100; }

// ─── Cache access for other routes ────────────────────────────────────────────

/** Returns all cached screener rows (may be empty on cold start) */
export function getScreenerData(): ScreenerRow[] {
  return cache.data;
}

/** Returns a single cached row by symbol, or undefined if not found */
export function getScreenerRow(symbol: string): ScreenerRow | undefined {
  return cache.data.find(r => r.symbol === symbol.toUpperCase());
}

/** Ensures the screener cache is warm; awaits initial load if empty */
export async function ensureScreenerReady(): Promise<void> {
  if (cache.data.length === 0) await triggerRefresh();
}

export { daysUntilEarnings };

export default router;
