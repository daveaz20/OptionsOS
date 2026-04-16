import { Router, type IRouter } from "express";
import { db, watchlistTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetTopMoversResponse,
} from "@workspace/api-zod";
import { getScreenerData, ensureScreenerReady } from "./screener.js";

function hashSymbol(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return (h % 999) + 1;
}

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  await ensureScreenerReady();
  const stocks = getScreenerData();
  const watchlist = await db.select().from(watchlistTable);

  const bullish = stocks.filter((s) => s.changePercent > 0).length;
  const bearish = stocks.filter((s) => s.changePercent < 0).length;
  const neutral = stocks.filter((s) => s.changePercent === 0).length;
  const avgStrength =
    stocks.length > 0
      ? Math.round(
          (stocks.reduce((acc, s) => acc + s.technicalStrength, 0) / stocks.length) * 10
        ) / 10
      : 0;

  const sentiment = bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : "neutral";

  res.json(
    GetDashboardSummaryResponse.parse({
      totalStocks: stocks.length,
      watchlistCount: watchlist.length,
      avgTechnicalStrength: avgStrength,
      bullishCount: bullish,
      bearishCount: bearish,
      neutralCount: neutral,
      marketSentiment: sentiment,
    })
  );
});

router.get("/dashboard/top-movers", async (_req, res): Promise<void> => {
  await ensureScreenerReady();
  const rows = getScreenerData();

  const toMover = (r: ReturnType<typeof getScreenerData>[number]) => ({
    id:               hashSymbol(r.symbol),
    symbol:           r.symbol,
    name:             r.name,
    price:            r.price,
    change:           r.change,
    changePercent:    r.changePercent,
    volume:           r.volume,
    marketCap:        r.marketCap,
    sector:           r.sector,
    technicalStrength: Math.max(1, Math.min(10, r.technicalStrength)),
  });

  const gainers = [...rows]
    .filter(r => r.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 5)
    .map(toMover);

  const losers = [...rows]
    .filter(r => r.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, 5)
    .map(toMover);

  res.json(GetTopMoversResponse.parse({ gainers, losers }));
});

export default router;
