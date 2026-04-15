import { Router, type IRouter } from "express";
import { desc, asc, sql } from "drizzle-orm";
import { db, stocksTable, watchlistTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetTopMoversResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const stocks = await db.select().from(stocksTable);
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
  const gainers = await db
    .select()
    .from(stocksTable)
    .where(sql`${stocksTable.changePercent} > 0`)
    .orderBy(desc(stocksTable.changePercent))
    .limit(5);

  const losers = await db
    .select()
    .from(stocksTable)
    .where(sql`${stocksTable.changePercent} < 0`)
    .orderBy(asc(stocksTable.changePercent))
    .limit(5);

  res.json(GetTopMoversResponse.parse({ gainers, losers }));
});

export default router;
