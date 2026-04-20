import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, stocksTable, watchlistTable } from "@workspace/db";
import { AddToWatchlistBody, RemoveFromWatchlistParams } from "@workspace/api-zod";
import { isPolygonEnabled } from "../lib/polygon.js";
import { getScreenerRow, ensureScreenerReady } from "./screener.js";

const router: IRouter = Router();

// Look up live stock data: screener cache first (Polygon path), then stocksTable fallback
async function resolveStockData(symbol: string) {
  if (isPolygonEnabled()) {
    await ensureScreenerReady();
    const row = getScreenerRow(symbol);
    if (row) return { name: row.name, price: row.price, change: row.change, changePercent: row.changePercent, technicalStrength: row.technicalStrength, ivRank: row.ivRank, opportunityScore: row.opportunityScore, setupType: row.setupType, recommendedOutlook: row.recommendedOutlook };
  }
  const [stock] = await db.select().from(stocksTable).where(eq(stocksTable.symbol, symbol));
  if (!stock) return null;
  return { name: stock.name, price: stock.price, change: stock.change, changePercent: stock.changePercent, technicalStrength: stock.technicalStrength, ivRank: stock.ivRank, opportunityScore: undefined, setupType: undefined, recommendedOutlook: undefined };
}

router.get("/watchlist", async (_req, res): Promise<void> => {
  const entries = await db.select().from(watchlistTable).orderBy(watchlistTable.addedAt);
  const items = await Promise.all(entries.map(async (entry) => {
    const data = await resolveStockData(entry.symbol);
    if (!data) return null;
    return { id: entry.id, symbol: entry.symbol, addedAt: entry.addedAt.toISOString(), ...data };
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
