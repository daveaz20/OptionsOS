/**
 * /api/screener — institutional-grade bulk screener endpoint
 * Stale-while-revalidate: serves cached data instantly, refreshes in background.
 */
import { Router, type IRouter } from "express";
import {
  getQuotes,
  getPriceHistory,
  getHistoricalVolatility,
  DEFAULT_UNIVERSE,
} from "../lib/market-data.js";
import { computeSignals } from "../lib/technical-analysis.js";
import { scanOpportunity } from "../lib/scanner.js";

const router: IRouter = Router();

const SCREENER_TTL = 10 * 60 * 1000; // 10 minutes

export interface ScreenerRow {
  symbol: string; name: string; price: number; change: number; changePercent: number;
  volume: number; avgVolume: number; relVol: number; marketCap: number; sector: string;
  beta: number; pe: number; forwardPE: number; eps: number; dividendYield: number;
  shortRatio: number; priceTarget: number; recommendation: number;
  fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number;
  pctFrom52High: number; pctFrom52Low: number; earningsDate: string;
  technicalStrength: number; rsi14: number; macdHistogram: number; ivRank: number;
  opportunityScore: number; setupType: string; recommendedOutlook: string;
  supportPrice: number; resistancePrice: number;
  liquidity: "Liquid" | "Illiquid";
}

interface Cache { data: ScreenerRow[]; at: number; promise: Promise<void> | null }
const cache: Cache = { data: [], at: 0, promise: null };

async function doRefresh(): Promise<void> {
  try {
    const universe = [...new Set(DEFAULT_UNIVERSE)];
    const quotes   = await getQuotes(universe);
    const rows: ScreenerRow[] = [];

    for (let i = 0; i < quotes.length; i += 12) {
      const batch   = quotes.slice(i, i + 12);
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
        };
        try {
          const [history, hv] = await Promise.all([
            getPriceHistory(q.symbol, "3M"),
            getHistoricalVolatility(q.symbol),
          ]);
          const sig  = computeSignals(history, q.price);
          const scan = scanOpportunity(sig, hv.ivRank, q.price, q.changePercent);
          return {
            ...base,
            technicalStrength: Math.round(sig.strength),
            rsi14: r2(sig.rsi14), macdHistogram: r2(sig.macd.histogram),
            ivRank: r2(hv.ivRank),
            opportunityScore: scan?.opportunityScore ?? 40,
            setupType: scan?.setupType ?? "Neutral",
            recommendedOutlook: scan?.recommendedOutlook ?? "neutral",
            supportPrice: sig.support, resistancePrice: sig.resistance,
          } satisfies ScreenerRow;
        } catch {
          return {
            ...base,
            technicalStrength: 5, rsi14: 50, macdHistogram: 0, ivRank: 30,
            opportunityScore: 40, setupType: "Neutral", recommendedOutlook: "neutral",
            supportPrice: r2(q.price * 0.94), resistancePrice: r2(q.price * 1.06),
          } satisfies ScreenerRow;
        }
      }));
      for (const r of results) {
        if (r.status === "fulfilled") rows.push(r.value);
      }
    }

    cache.data = rows;
    cache.at   = Date.now();
  } catch (err) {
    console.error("[screener] refresh error", err);
  } finally {
    cache.promise = null;
  }
}

function triggerRefresh() {
  if (!cache.promise) {
    cache.promise = doRefresh();
  }
  return cache.promise;
}

// Warm up at startup
triggerRefresh().catch(() => {});

router.get("/screener", async (req, res): Promise<void> => {
  // First load: wait for data
  if (cache.data.length === 0) {
    await triggerRefresh();
  }

  // Serve current data (may be stale — that's fine)
  res.json(cache.data);

  // Refresh in background if stale
  if (Date.now() - cache.at > SCREENER_TTL) {
    triggerRefresh().catch(() => {});
  }
});

function r2(n: number) { return Math.round(n * 100) / 100; }

export default router;
