/**
 * /api/screener — institutional-grade bulk screener endpoint
 * Returns the full enriched universe without Zod stripping,
 * so the frontend gets every field needed for factor scoring.
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

// In-memory screener cache — heavier endpoint, 3 min TTL
const screenerCache: { data: ScreenerRow[]; at: number } = { data: [], at: 0 };
const SCREENER_TTL = 3 * 60 * 1000;

export interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  relVol: number;
  marketCap: number;
  sector: string;
  beta: number;
  pe: number;
  forwardPE: number;
  eps: number;
  dividendYield: number;
  shortRatio: number;
  priceTarget: number;
  recommendation: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  pctFrom52High: number;
  pctFrom52Low: number;
  earningsDate: string;
  technicalStrength: number;
  rsi14: number;
  macdHistogram: number;
  ivRank: number;
  opportunityScore: number;
  setupType: string;
  recommendedOutlook: string;
  supportPrice: number;
  resistancePrice: number;
  liquidity: "Liquid" | "Illiquid";
}

router.get("/screener", async (req, res): Promise<void> => {
  const now = Date.now();
  if (screenerCache.data.length > 0 && now - screenerCache.at < SCREENER_TTL) {
    res.json(screenerCache.data);
    return;
  }

  const universe = [...new Set(DEFAULT_UNIVERSE)];
  const quotes = await getQuotes(universe);

  const CONCURRENCY = 12;
  const rows: ScreenerRow[] = [];

  for (let i = 0; i < quotes.length; i += CONCURRENCY) {
    const batch = quotes.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (q) => {
        try {
          const [history, hv] = await Promise.all([
            getPriceHistory(q.symbol, "3M"),
            getHistoricalVolatility(q.symbol),
          ]);
          const sig = computeSignals(history, q.price);
          const scan = scanOpportunity(sig, hv.ivRank, q.price, q.changePercent);

          const hi = q.fiftyTwoWeekHigh || q.price;
          const lo = q.fiftyTwoWeekLow || q.price;

          const row: ScreenerRow = {
            symbol: q.symbol,
            name: q.name,
            price: q.price,
            change: r2(q.change),
            changePercent: r2(q.changePercent),
            volume: q.volume,
            avgVolume: q.avgVolume,
            relVol: r2(q.relVol),
            marketCap: q.marketCap,
            sector: q.sector,
            beta: r2(q.beta),
            pe: r2(q.pe),
            forwardPE: r2(q.forwardPE),
            eps: r2(q.eps),
            dividendYield: r2(q.dividendYield * 100),
            shortRatio: r2(q.shortRatio),
            priceTarget: r2(q.priceTarget),
            recommendation: r2(q.recommendation),
            fiftyTwoWeekHigh: hi,
            fiftyTwoWeekLow: lo,
            pctFrom52High: r2(((q.price - hi) / hi) * 100),
            pctFrom52Low: r2(((q.price - lo) / lo) * 100),
            earningsDate: q.earningsDate,
            technicalStrength: Math.round(sig.strength),
            rsi14: r2(sig.rsi14),
            macdHistogram: r2(sig.macd.histogram),
            ivRank: r2(hv.ivRank),
            opportunityScore: scan?.opportunityScore ?? 40,
            setupType: scan?.setupType ?? "Neutral",
            recommendedOutlook: scan?.recommendedOutlook ?? "neutral",
            supportPrice: sig.support,
            resistancePrice: sig.resistance,
            liquidity: q.avgVolume > 1_000_000 ? "Liquid" : "Illiquid",
          };
          return row;
        } catch {
          const hi = q.fiftyTwoWeekHigh || q.price;
          const lo = q.fiftyTwoWeekLow || q.price;
          return {
            symbol: q.symbol,
            name: q.name,
            price: q.price,
            change: r2(q.change),
            changePercent: r2(q.changePercent),
            volume: q.volume,
            avgVolume: q.avgVolume,
            relVol: r2(q.relVol),
            marketCap: q.marketCap,
            sector: q.sector,
            beta: r2(q.beta),
            pe: r2(q.pe),
            forwardPE: r2(q.forwardPE),
            eps: r2(q.eps),
            dividendYield: r2(q.dividendYield * 100),
            shortRatio: r2(q.shortRatio),
            priceTarget: r2(q.priceTarget),
            recommendation: r2(q.recommendation),
            fiftyTwoWeekHigh: hi,
            fiftyTwoWeekLow: lo,
            pctFrom52High: r2(((q.price - hi) / hi) * 100),
            pctFrom52Low: r2(((q.price - lo) / lo) * 100),
            earningsDate: q.earningsDate,
            technicalStrength: 5,
            rsi14: 50,
            macdHistogram: 0,
            ivRank: 30,
            opportunityScore: 40,
            setupType: "Neutral",
            recommendedOutlook: "neutral",
            supportPrice: r2(q.price * 0.94),
            resistancePrice: r2(q.price * 1.06),
            liquidity: q.avgVolume > 1_000_000 ? "Liquid" : "Illiquid",
          } satisfies ScreenerRow;
        }
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") rows.push(r.value);
    }
  }

  screenerCache.data = rows;
  screenerCache.at = now;
  res.json(rows);
});

function r2(n: number) { return Math.round(n * 100) / 100; }

export default router;
