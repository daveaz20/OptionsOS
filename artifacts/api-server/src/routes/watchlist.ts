import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, stocksTable, watchlistTable } from "@workspace/db";
import {
  AddToWatchlistBody,
  RemoveFromWatchlistParams,
  GetWatchlistResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/watchlist", async (_req, res): Promise<void> => {
  const items = await db
    .select({
      id: watchlistTable.id,
      symbol: watchlistTable.symbol,
      name: stocksTable.name,
      price: stocksTable.price,
      change: stocksTable.change,
      changePercent: stocksTable.changePercent,
      technicalStrength: stocksTable.technicalStrength,
      addedAt: watchlistTable.addedAt,
    })
    .from(watchlistTable)
    .innerJoin(stocksTable, eq(watchlistTable.symbol, stocksTable.symbol))
    .orderBy(watchlistTable.addedAt);

  const serialized = items.map((item) => ({
    ...item,
    addedAt: item.addedAt.toISOString(),
  }));

  res.json(GetWatchlistResponse.parse(serialized));
});

router.post("/watchlist", async (req, res): Promise<void> => {
  const parsed = AddToWatchlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [stock] = await db
    .select()
    .from(stocksTable)
    .where(eq(stocksTable.symbol, parsed.data.symbol.toUpperCase()));

  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const [existing] = await db
    .select()
    .from(watchlistTable)
    .where(eq(watchlistTable.symbol, parsed.data.symbol.toUpperCase()));

  if (existing) {
    res.status(409).json({ error: "Already in watchlist" });
    return;
  }

  const [entry] = await db
    .insert(watchlistTable)
    .values({ symbol: parsed.data.symbol.toUpperCase() })
    .returning();

  if (!entry) {
    res.status(500).json({ error: "Insert failed" });
    return;
  }

  res.status(201).json({
    id: entry.id,
    symbol: entry.symbol,
    name: stock.name,
    price: stock.price,
    change: stock.change,
    changePercent: stock.changePercent,
    technicalStrength: stock.technicalStrength,
    addedAt: entry.addedAt.toISOString(),
  });
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
