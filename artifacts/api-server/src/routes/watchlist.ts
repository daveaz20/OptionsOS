import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, stocksTable, userSettingsTable, watchlistTable } from "@workspace/db";
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

interface WatchlistSettings {
  maxWatchlistSize: number;
  allowDuplicateWatchlistSymbols: boolean;
  alertWatchlistScoreDrop: boolean;
  watchlistScoreDropAlertThreshold: number;
  watchlistEarningsAlertDays: number;
  watchlistIvSpikeAlertThreshold: number;
}

async function getWatchlistSettings(): Promise<WatchlistSettings> {
  const rows = await db.select().from(userSettingsTable);
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
  return {
    maxWatchlistSize: typeof values.maxWatchlistSize === "number" ? values.maxWatchlistSize : 50,
    allowDuplicateWatchlistSymbols: typeof values.allowDuplicateWatchlistSymbols === "boolean" ? values.allowDuplicateWatchlistSymbols : false,
    alertWatchlistScoreDrop: typeof values.alertWatchlistScoreDrop === "boolean" ? values.alertWatchlistScoreDrop : false,
    watchlistScoreDropAlertThreshold: typeof values.watchlistScoreDropAlertThreshold === "number" ? values.watchlistScoreDropAlertThreshold : 60,
    watchlistEarningsAlertDays: typeof values.watchlistEarningsAlertDays === "number" ? values.watchlistEarningsAlertDays : 5,
    watchlistIvSpikeAlertThreshold: typeof values.watchlistIvSpikeAlertThreshold === "number" ? values.watchlistIvSpikeAlertThreshold : 70,
  };
}

function daysUntil(dateText: unknown): number | null {
  if (typeof dateText !== "string" || !dateText || dateText === "TBD") return null;
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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
        earningsDate: row.earningsDate,
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
    earningsDate: undefined,
  };
}

function buildWatchlistAlerts(data: any, settings: WatchlistSettings) {
  const alerts: Array<{ type: string; label: string; severity: "warning" | "danger" }> = [];
  const score = Number(data.opportunityScore ?? 0);
  const ivRank = Number(data.ivRank ?? 0);
  const earningsDays = daysUntil(data.earningsDate);

  if (settings.alertWatchlistScoreDrop && score > 0 && score < settings.watchlistScoreDropAlertThreshold) {
    alerts.push({ type: "score", label: `Score < ${settings.watchlistScoreDropAlertThreshold}`, severity: "danger" });
  }
  if (earningsDays !== null && earningsDays >= 0 && earningsDays <= settings.watchlistEarningsAlertDays) {
    alerts.push({ type: "earnings", label: `Earnings ${earningsDays}d`, severity: "warning" });
  }
  if (ivRank >= settings.watchlistIvSpikeAlertThreshold) {
    alerts.push({ type: "iv", label: `IV ${Math.round(ivRank)}%`, severity: "warning" });
  }

  return alerts;
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
  const settings = await getWatchlistSettings();
  const symbols = entries.map((entry) => entry.symbol.toUpperCase());
  const tastytradeQuotes = await getTastytradeQuoteMap(symbols);
  const items = await Promise.all(entries.map(async (entry) => {
    const data = await resolveStockData(entry.symbol);
    if (!data) return null;
    const liveQuote = tastytradeQuotes.get(entry.symbol.toUpperCase());
    const merged = { ...data, ...(liveQuote ?? {}) };
    return {
      id: entry.id,
      symbol: entry.symbol,
      addedAt: entry.addedAt.toISOString(),
      ...merged,
      alerts: buildWatchlistAlerts(merged, settings),
      lastUpdated: new Date().toISOString(),
    };
  }));
  res.json(items.filter(Boolean));
});

router.get("/watchlist/export", async (_req, res): Promise<void> => {
  const settings = await getWatchlistSettings();
  const entries = await db.select().from(watchlistTable).orderBy(watchlistTable.addedAt);
  const symbols = entries.map((entry) => entry.symbol.toUpperCase());
  const tastytradeQuotes = await getTastytradeQuoteMap(symbols);
  const rows = await Promise.all(entries.map(async (entry) => {
    const data = await resolveStockData(entry.symbol);
    const liveQuote = tastytradeQuotes.get(entry.symbol.toUpperCase());
    const merged = { ...(data ?? {}), ...(liveQuote ?? {}) } as Record<string, unknown>;
    const alerts = buildWatchlistAlerts(merged, settings).map((alert) => alert.label).join("; ");
    return [entry.symbol, merged.name, merged.price, merged.changePercent, merged.opportunityScore, merged.setupType, merged.ivRank, merged.earningsDate, entry.addedAt.toISOString(), alerts];
  }));
  const header = ["Symbol", "Name", "Price", "ChangePercent", "OpportunityScore", "SetupType", "IVRank", "EarningsDate", "AddedAt", "Alerts"];
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"watchlist.csv\"");
  res.send(csv);
});

router.post("/watchlist", async (req, res): Promise<void> => {
  const parsed = AddToWatchlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const symbol = parsed.data.symbol.toUpperCase();
  const settings = await getWatchlistSettings();
  const entries = await db.select().from(watchlistTable);
  if (entries.length >= settings.maxWatchlistSize) {
    res.status(409).json({ error: `Watchlist limit reached (${settings.maxWatchlistSize})` });
    return;
  }
  const data = await resolveStockData(symbol);
  if (!data) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const existing = entries.find((entry) => entry.symbol.toUpperCase() === symbol);
  if (existing && !settings.allowDuplicateWatchlistSymbols) {
    res.status(409).json({ error: "Already in watchlist" });
    return;
  }

  const [entry] = await db.insert(watchlistTable).values({ symbol }).returning();
  if (!entry) {
    res.status(500).json({ error: "Insert failed" });
    return;
  }

  res.status(201).json({ id: entry.id, symbol: entry.symbol, addedAt: entry.addedAt.toISOString(), ...data, alerts: buildWatchlistAlerts(data, settings), lastUpdated: new Date().toISOString() });
});

router.delete("/watchlist", async (_req, res): Promise<void> => {
  await db.delete(watchlistTable);
  res.json({ ok: true });
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
