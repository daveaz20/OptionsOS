import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, stocksTable, watchlistTable } from "@workspace/db";
import { AddToWatchlistBody, RemoveFromWatchlistParams } from "@workspace/api-zod";
import { isPolygonEnabled } from "../lib/polygon.js";
import { getScreenerRow, ensureScreenerReady } from "./screener.js";
import {
  getQuoteSnapshots,
  getStreamedQuote,
  isStreamerConnected,
  isTastytradeAuthorized,
  isTastytradeEnabled,
  subscribeQuotes,
} from "../lib/tastytrade.js";

const router: IRouter = Router();

// Look up live stock data: screener cache first (Polygon path), then stocksTable fallback
async function resolveStockData(symbol: string) {
  if (isPolygonEnabled()) {
    await ensureScreenerReady();
    const row = getScreenerRow(symbol);
    if (row) {
      return {
        name: row.name,
        price: row.price,
        change: row.change,
        changePercent: row.changePercent,
        technicalStrength: row.technicalStrength,
        ivRank: row.ivRank,
        opportunityScore: row.opportunityScore,
        setupType: row.setupType,
        recommendedOutlook: row.recommendedOutlook,
      };
    }
  }
  const [stock] = await db.select().from(stocksTable).where(eq(stocksTable.symbol, symbol));
  if (!stock) return null;
  return {
    name: stock.name,
    price: stock.price,
    change: stock.change,
    changePercent: stock.changePercent,
    technicalStrength: stock.technicalStrength,
    ivRank: stock.ivRank,
    opportunityScore: undefined,
    setupType: undefined,
    recommendedOutlook: undefined,
  };
}

async function getTastytradeQuoteMap(symbols: string[]) {
  const quoteMap = new Map<string, {
    price: number;
    change: number;
    changePercent: number;
    bid?: number;
    ask?: number;
    mark?: number;
    priceSource: "tastytrade-live" | "tastytrade-rest";
  }>();

  if (!isTastytradeEnabled() || !isTastytradeAuthorized() || symbols.length === 0) {
    return quoteMap;
  }

  try {
    subscribeQuotes(symbols);

    for (const symbol of symbols) {
      const streamed = getStreamedQuote(symbol);
      const livePrice = streamed?.last || streamed?.mark || 0;
      const previousClose = streamed?.previousClose ?? 0;
      if (!streamed || livePrice <= 0) continue;

      const change = previousClose > 0 ? livePrice - previousClose : 0;
      const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
      quoteMap.set(symbol, {
        price: livePrice,
        change,
        changePercent,
        bid: streamed.bid,
        ask: streamed.ask,
        mark: streamed.mark,
        priceSource: "tastytrade-live",
      });
    }

    const missing = symbols.filter((symbol) => !quoteMap.has(symbol));
    if (missing.length > 0 && !isStreamerConnected()) {
      const snapshots = await getQuoteSnapshots(missing);
      for (const symbol of missing) {
        const snapshot = snapshots.get(symbol);
        if (!snapshot) continue;
        quoteMap.set(symbol, {
          price: snapshot.last || snapshot.mark || snapshot.bid || snapshot.ask || 0,
          change: 0,
          changePercent: 0,
          bid: snapshot.bid,
          ask: snapshot.ask,
          mark: snapshot.mark,
          priceSource: "tastytrade-rest",
        });
      }
    }
  } catch (err) {
    console.warn("[watchlist] tastytrade quote merge failed:", (err as Error).message);
  }

  return quoteMap;
}

router.get("/watchlist", async (_req, res): Promise<void> => {
  const entries = await db.select().from(watchlistTable).orderBy(watchlistTable.addedAt);
  const symbols = entries.map((entry) => entry.symbol.toUpperCase());
  const tastytradeQuotes = await getTastytradeQuoteMap(symbols);
  const items = await Promise.all(entries.map(async (entry) => {
    const data = await resolveStockData(entry.symbol);
    if (!data) return null;
    const liveQuote = tastytradeQuotes.get(entry.symbol.toUpperCase());
    return {
      id: entry.id,
      symbol: entry.symbol,
      addedAt: entry.addedAt.toISOString(),
      ...data,
      ...(liveQuote ?? {}),
    };
  }));
  res.json(items.filter(Boolean));
});

router.post("/watchlist", async (req, res): Promise<void> => {
  const parsed = AddToWatchlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const symbol = parsed.data.symbol.toUpperCase();
  const data = await resolveStockData(symbol);
  if (!data) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const [existing] = await db.select().from(watchlistTable).where(eq(watchlistTable.symbol, symbol));
  if (existing) {
    res.status(409).json({ error: "Already in watchlist" });
    return;
  }

  const [entry] = await db.insert(watchlistTable).values({ symbol }).returning();
  if (!entry) {
    res.status(500).json({ error: "Insert failed" });
    return;
  }

  res.status(201).json({ id: entry.id, symbol: entry.symbol, addedAt: entry.addedAt.toISOString(), ...data });
});

router.delete("/watchlist/:id", async (req, res): Promise<void> => {
  const params = RemoveFromWatchlistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rawId = Array.isArray(params.data.id) ? params.data.id[0] : params.data.id;
  const id = typeof rawId === "string" ? parseInt(rawId, 10) : rawId;

  const [deleted] = await db
    .delete(watchlistTable)
    .where(eq(watchlistTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
