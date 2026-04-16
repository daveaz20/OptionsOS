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
  DEFAULT_UNIVERSE,
  getSectorForSymbol,
} from "../lib/market-data.js";
import { computeSignals } from "../lib/technical-analysis.js";
import { scanOpportunity } from "../lib/scanner.js";
import {
  isPolygonEnabled,
  getPolygonSnapshots,
  getPolygonTickers,
  getPolygonBars,
} from "../lib/polygon.js";
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
  opportunityScore: number; technicalScore: number; ivScore: number; entryScore: number; momentumScore: number;
  setupType: string; recommendedOutlook: string;
  supportPrice: number; resistancePrice: number;
  liquidity: "Liquid" | "Illiquid";
  source: "polygon" | "yahoo";
}

interface Cache { data: ScreenerRow[]; at: number; promise: Promise<void> | null }
const cache: Cache = { data: [], at: 0, promise: null };

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
  const universe = [...new Set(DEFAULT_UNIVERSE)];
  const quotes   = await getQuotes(universe);
  const rows: ScreenerRow[] = [];

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
        liquidity: (q.avgVolume > 1_000_000 ? "Liquid" : "Illiquid") as const,
        source: "yahoo" as const,
      };
      try {
        const [history, hv] = await Promise.all([
          getPriceHistory(q.symbol, "TECH"),
          getHistoricalVolatility(q.symbol),
        ]);
        const sig  = computeSignals(history, q.price);
        const dte  = daysUntilEarnings(q.earningsDate);
        const scan = scanOpportunity(sig, hv.ivRank, q.price, q.changePercent, dte);
        return {
          ...base,
          technicalStrength: Math.round(sig.strength),
          rsi14: r2(sig.rsi14), macdHistogram: r2(sig.macd.histogram),
          ivRank: r2(hv.ivRank),
          opportunityScore: scan?.opportunityScore ?? 40,
          technicalScore: scan?.technicalScore ?? 0,
          ivScore: scan?.ivScore ?? 0,
          entryScore: scan?.entryScore ?? 0,
          momentumScore: scan?.momentumScore ?? 0,
          setupType: scan?.setupType ?? "Neutral",
          recommendedOutlook: scan?.recommendedOutlook ?? "neutral",
          supportPrice: sig.support, resistancePrice: sig.resistance,
        } satisfies ScreenerRow;
      } catch (err) {
        console.error(`[screener] technicals failed for ${q.symbol}:`, (err as Error)?.message ?? err);
        return {
          ...base,
          technicalStrength: 5, rsi14: 50, macdHistogram: 0, ivRank: 30,
          opportunityScore: 40, technicalScore: 0, ivScore: 0, entryScore: 0, momentumScore: 0,
          setupType: "Neutral", recommendedOutlook: "neutral",
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

  // Fetch in parallel: snapshots + reference metadata
  const [snaps, tickerMap] = await Promise.all([
    getPolygonSnapshots(),
    getPolygonTickers(),
  ]);

  // Filter to investable universe:
  // - Must exist in our reference map (so we have a company name)
  // - Common stock (CS) OR listed ADR (ADRC) OR trust (ignore ETF, preferred, etc.)
  // - Price ≥ $2 (no deep penny stocks)
  // - Day volume ≥ 100 000
  const VALID_TYPES = new Set(["CS", "ADRC"]);

  const filtered = snaps.filter((s) => {
    const ref = tickerMap.get(s.ticker);
    if (!ref) return false;
    if (!VALID_TYPES.has(ref.type)) return false;
    const price = s.day?.c ?? s.lastTrade?.p ?? 0;
    const vol   = s.day?.v ?? 0;
    return price >= 2 && vol >= 100_000;
  });

  console.log(`[polygon] ${snaps.length} snaps → ${filtered.length} quality stocks`);

  // For our curated universe, run full technical analysis (batched, 12 concurrent)
  const knownSet = new Set(DEFAULT_UNIVERSE);
  const knownSnaps = filtered.filter(s => knownSet.has(s.ticker));
  const unknownSnaps = filtered.filter(s => !knownSet.has(s.ticker));

  // Build rows for known universe (full technicals via Yahoo Finance)
  const knownRows = await buildKnownRows(knownSnaps, tickerMap);

  // Build rows for Polygon-only stocks (basic data, estimated technicals)
  const unknownRows = unknownSnaps.map(s => buildPolygonRow(s, tickerMap));

  const all = [...knownRows, ...unknownRows];
  console.log(`[polygon] total: ${all.length} rows (${knownRows.length} full + ${unknownRows.length} basic)`);
  return all;
}

async function buildKnownRows(
  snaps: Awaited<ReturnType<typeof getPolygonSnapshots>>,
  tickerMap: Map<string, any>
): Promise<ScreenerRow[]> {
  // Re-use Yahoo Finance for known symbols to get full fundamentals + technicals
  const symbols = snaps.map(s => s.ticker);
  const quotes  = await getQuotes(symbols);
  const quoteMap = new Map(quotes.map(q => [q.symbol, q]));
  const rows: ScreenerRow[] = [];

  for (let i = 0; i < snaps.length; i += 25) {
    const batch   = snaps.slice(i, i + 25);
    const results = await Promise.allSettled(batch.map(async (s) => {
      const q   = quoteMap.get(s.ticker);
      const ref = tickerMap.get(s.ticker);
      const price  = s.day?.c ?? s.lastTrade?.p ?? q?.price ?? 0;
      const change = s.todaysChange ?? q?.change ?? 0;
      const chPct  = s.todaysChangePerc ?? q?.changePercent ?? 0;
      const vol    = s.day?.v ?? q?.volume ?? 0;
      const prevVol= s.prevDay?.v ?? vol;
      const relVol = prevVol > 0 ? r2(vol / prevVol) : 1;
      const hi52   = q?.fiftyTwoWeekHigh  || price * 1.3;
      const lo52   = q?.fiftyTwoWeekLow   || price * 0.7;

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
        liquidity: (vol > 1_000_000 ? "Liquid" : "Illiquid") as const,
        source: "polygon" as const,
      };

      try {
        const [history, hv] = await Promise.all([
          getPolygonBars(s.ticker, 580),   // 580 days covers SMA200 + MACD/RSI warmup
          getHistoricalVolatility(s.ticker),
        ]);
        const sig  = computeSignals(history, price);
        const dte  = daysUntilEarnings(q?.earningsDate ?? "TBD");
        const scan = scanOpportunity(sig, hv.ivRank, price, chPct, dte);
        return {
          ...base,
          technicalStrength: Math.round(sig.strength),
          rsi14: r2(sig.rsi14), macdHistogram: r2(sig.macd.histogram),
          ivRank: r2(hv.ivRank),
          opportunityScore: scan?.opportunityScore ?? 40,
          technicalScore: scan?.technicalScore ?? 0,
          ivScore: scan?.ivScore ?? 0,
          entryScore: scan?.entryScore ?? 0,
          momentumScore: scan?.momentumScore ?? 0,
          setupType: scan?.setupType ?? "Neutral",
          recommendedOutlook: scan?.recommendedOutlook ?? "neutral",
          supportPrice: sig.support, resistancePrice: sig.resistance,
        } satisfies ScreenerRow;
      } catch (err) {
        console.error(`[screener] technicals failed for ${s.ticker}:`, (err as Error)?.message ?? err);
        return {
          ...base,
          technicalStrength: 5, rsi14: 50, macdHistogram: 0, ivRank: 30,
          opportunityScore: 40, technicalScore: 0, ivScore: 0, entryScore: 0, momentumScore: 0,
          setupType: "Neutral", recommendedOutlook: "neutral",
          supportPrice: r2(price * 0.94), resistancePrice: r2(price * 1.06),
        } satisfies ScreenerRow;
      }
    }));
    for (const r of results) {
      if (r.status === "fulfilled") rows.push(r.value);
    }
  }
  return rows;
}

function buildPolygonRow(
  s: Awaited<ReturnType<typeof getPolygonSnapshots>>[0],
  tickerMap: Map<string, any>
): ScreenerRow {
  const ref    = tickerMap.get(s.ticker);
  const price  = s.day?.c ?? s.lastTrade?.p ?? 0;
  const vol    = s.day?.v ?? 0;
  const prevVol= s.prevDay?.v ?? vol;
  const relVol = prevVol > 0 ? r2(vol / prevVol) : 1;
  const chPct  = s.todaysChangePerc ?? 0;
  const chg    = s.todaysChange ?? 0;

  const sector = getSectorForSymbol(s.ticker);

  // Estimate technicals from just price action
  const rsi = chPct > 3 ? 65 : chPct > 1 ? 58 : chPct < -3 ? 35 : chPct < -1 ? 42 : 50;
  const techStrength = Math.max(1, Math.min(10, 5 + (chPct / 2)));
  const outlook = chPct > 1 && relVol > 1.5 ? "bullish" : chPct < -1 ? "bearish" : "neutral";

  return {
    symbol: s.ticker,
    name: ref?.name ?? s.ticker,
    price: r2(price), change: r2(chg), changePercent: r2(chPct),
    volume: vol, avgVolume: prevVol, relVol,
    marketCap: 0,         // unknown without per-ticker lookup
    sector,
    beta: 1, pe: 0, forwardPE: 0, eps: 0, dividendYield: 0,
    shortRatio: 0, priceTarget: 0, recommendation: 3,
    fiftyTwoWeekHigh: s.day?.h ?? price, fiftyTwoWeekLow: s.day?.l ?? price,
    pctFrom52High: 0, pctFrom52Low: 0, earningsDate: "TBD",
    technicalStrength: r2(techStrength), rsi14: rsi, macdHistogram: 0, ivRank: 30,
    opportunityScore: 40, technicalScore: 0, ivScore: 0, entryScore: 0, momentumScore: 0,
    setupType: "Neutral", recommendedOutlook: outlook,
    supportPrice: r2(price * 0.94), resistancePrice: r2(price * 1.06),
    liquidity: (vol > 1_000_000 ? "Liquid" : "Illiquid"),
    source: "polygon",
  };
}

// ─── Cache + route ────────────────────────────────────────────────────────────

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
  return r.opportunityScore >= 75
    && r.technicalScore >= 20
    && r.ivScore >= 15
    && r.entryScore >= 15
    && r.momentumScore >= 8;
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

  const bestScore = rows.reduce((mx, r) => Math.max(mx, r.opportunityScore), 0);

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
