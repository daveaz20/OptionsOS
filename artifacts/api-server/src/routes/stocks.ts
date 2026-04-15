import { Router, type IRouter } from "express";
import { like, desc, asc, sql } from "drizzle-orm";
import { db, stocksTable } from "@workspace/db";
import {
  ListStocksQueryParams,
  ListStocksResponse,
  GetStockParams,
  GetStockResponse,
  GetStockPriceHistoryParams,
  GetStockPriceHistoryQueryParams,
  GetStockPriceHistoryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stocks", async (req, res): Promise<void> => {
  const query = ListStocksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { search, limit } = query.data;

  let q = db.select().from(stocksTable).orderBy(asc(stocksTable.symbol)).$dynamic();

  if (search) {
    q = q.where(
      sql`(${stocksTable.symbol} ILIKE ${`%${search}%`} OR ${stocksTable.name} ILIKE ${`%${search}%`})`
    );
  }

  if (limit) {
    q = q.limit(limit);
  }

  const stocks = await q;
  res.json(ListStocksResponse.parse(stocks));
});

router.get("/stocks/:symbol", async (req, res): Promise<void> => {
  const params = GetStockParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const symbol = Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol;

  const [stock] = await db
    .select()
    .from(stocksTable)
    .where(sql`${stocksTable.symbol} = ${symbol.toUpperCase()}`);

  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  res.json(GetStockResponse.parse(stock));
});

router.get("/stocks/:symbol/price-history", async (req, res): Promise<void> => {
  const params = GetStockPriceHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetStockPriceHistoryQueryParams.safeParse(req.query);
  const period = query.success ? query.data.period : "3M";

  const symbol = Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol;

  const [stock] = await db
    .select()
    .from(stocksTable)
    .where(sql`${stocksTable.symbol} = ${symbol.toUpperCase()}`);

  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const days = periodToDays(period ?? "3M");
  const priceHistory = generatePriceHistory(stock.price, days);

  res.json(GetStockPriceHistoryResponse.parse(priceHistory));
});

function periodToDays(period: string): number {
  switch (period) {
    case "1D": return 1;
    case "1W": return 7;
    case "1M": return 30;
    case "3M": return 90;
    case "6M": return 180;
    case "1Y": return 365;
    default: return 90;
  }
}

function generatePriceHistory(currentPrice: number, days: number) {
  const points = [];
  const now = new Date();
  let price = currentPrice * (0.85 + Math.random() * 0.15);

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);

    const volatility = 0.02;
    const drift = (currentPrice - price) / (i + 1) * 0.1;
    const change = price * (drift / price + volatility * (Math.random() - 0.5));
    price = Math.max(price + change, 1);

    const dayHigh = price * (1 + Math.random() * 0.02);
    const dayLow = price * (1 - Math.random() * 0.02);
    const open = price + (Math.random() - 0.5) * price * 0.01;

    points.push({
      date: date.toISOString().split("T")[0],
      open: Math.round(open * 100) / 100,
      high: Math.round(dayHigh * 100) / 100,
      low: Math.round(dayLow * 100) / 100,
      close: Math.round(price * 100) / 100,
      volume: Math.round(10000000 + Math.random() * 50000000),
    });
  }

  return points;
}

export default router;
