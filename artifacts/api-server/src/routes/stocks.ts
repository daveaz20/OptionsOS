import { Router, type IRouter } from "express";
import {
  ListStocksQueryParams,
  ListStocksResponse,
  GetStockParams,
  GetStockResponse,
  GetStockPriceHistoryParams,
  GetStockPriceHistoryQueryParams,
  GetStockPriceHistoryResponse,
} from "@workspace/api-zod";
import { getQuote, getPriceHistory, getHistoricalVolatility, DEFAULT_UNIVERSE } from "../lib/market-data.js";
import { computeSignals } from "../lib/technical-analysis.js";
import { scanOpportunity } from "../lib/scanner.js";
import { isPolygonEnabled } from "../lib/polygon.js";
import {
  getScreenerData,
  getScreenerRow,
  ensureScreenerReady,
  daysUntilEarnings,
  type ScreenerRow,
} from "./screener.js";

const router: IRouter = Router();

// ─── GET /stocks ─────────────────────────────────────────────────────────────
// When Polygon is active: serve from the shared screener cache (same universe,
// same scores — no duplication of work, instant response after warm-up).
// Fallback: live Yahoo Finance fetch for the curated 477-stock universe.

router.get("/stocks", async (req, res): Promise<void> => {
  const query = ListStocksQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const { search, limit } = query.data;

  if (isPolygonEnabled()) {
    // ── Polygon path: serve from shared screener cache ─────────────────────
    await ensureScreenerReady();
    let rows = getScreenerData();

    if (search) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.symbol.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
      );
    }

    // Sort by opportunity score (best first)
    const sorted = [...rows].sort((a, b) => b.opportunityScore - a.opportunityScore);
    const limited = limit ? sorted.slice(0, limit) : sorted;
    const stocks = limited.map(screenerRowToStock);

    res.json(ListStocksResponse.parse(stocks));
    return;
  }

  // ── Yahoo-only fallback path (original behaviour) ──────────────────────────
  let universe = [...new Set(DEFAULT_UNIVERSE)];
  if (search) {
    const q = search.trim().toLowerCase();
    universe = universe.filter((s) => s.toLowerCase().includes(q));
  }

  const { getQuotes } = await import("../lib/market-data.js");
  const quotes = await getQuotes(universe);

  const CONCURRENCY = 8;
  const enriched: ReturnType<typeof quoteToStock>[] = [];
  for (let i = 0; i < quotes.length; i += CONCURRENCY) {
    const batch = quotes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (quote) => {
        try {
          const [history, hv] = await Promise.all([
            getPriceHistory(quote.symbol, "TECH"),
            getHistoricalVolatility(quote.symbol),
          ]);
          const signals = computeSignals(history, quote.price);
          const dte     = daysUntilEarnings(quote.earningsDate);
          const scan    = scanOpportunity(signals, hv.ivRank, quote.price, quote.changePercent, dte);
          return quoteToStock(quote, signals, hv.ivRank, scan);
        } catch {
          return quoteToStock(quote, null, 30, null);
        }
      })
    );
    enriched.push(...results);
  }

  enriched.sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
  const limited = limit ? enriched.slice(0, limit) : enriched;
  res.json(ListStocksResponse.parse(limited));
});

// ─── GET /stocks/:symbol ─────────────────────────────────────────────────────
// Serves from the screener cache (fast, consistent data) when Polygon is on.
// Falls back to live Yahoo Finance for symbols not yet in cache or when
// Polygon is disabled.

router.get("/stocks/:symbol", async (req, res): Promise<void> => {
  const params = GetStockParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const symbol = (Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol).toUpperCase();

  try {
    // ── Try screener cache first (avoids a redundant Yahoo call) ───────────
    if (isPolygonEnabled()) {
      const cached = getScreenerRow(symbol);
      if (cached) {
        res.json(GetStockResponse.parse(screenerRowToStock(cached)));
        return;
      }
    }

    // ── Live fetch fallback ─────────────────────────────────────────────────
    const [quote, history, hv] = await Promise.all([
      getQuote(symbol),
      getPriceHistory(symbol, "TECH"),
      getHistoricalVolatility(symbol),
    ]);
    const signals = computeSignals(history, quote.price);
    const dte     = daysUntilEarnings(quote.earningsDate);
    const scan    = scanOpportunity(signals, hv.ivRank, quote.price, quote.changePercent, dte);
    res.json(GetStockResponse.parse(quoteToStock(quote, signals, hv.ivRank, scan)));
  } catch {
    res.status(404).json({ error: `Symbol not found: ${symbol}` });
  }
});

// ─── GET /stocks/:symbol/price-history ───────────────────────────────────────

router.get("/stocks/:symbol/price-history", async (req, res): Promise<void> => {
  const params = GetStockPriceHistoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const query  = GetStockPriceHistoryQueryParams.safeParse(req.query);
  const period = query.success ? (query.data.period ?? "3M") : "3M";
  const symbol = (Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol).toUpperCase();

  try {
    const history = await getPriceHistory(symbol, period);
    res.json(GetStockPriceHistoryResponse.parse(history));
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch price history: ${err.message}` });
  }
});

// ─── Adapters ────────────────────────────────────────────────────────────────

/** Convert a ScreenerRow (full Polygon+Yahoo universe) into a Stock response shape. */
function screenerRowToStock(row: ScreenerRow) {
  const outlook  = row.recommendedOutlook as "bullish" | "bearish" | "neutral";
  const trendStr = outlook === "bullish" ? "Bullish" : outlook === "bearish" ? "Bearish" : "Neutral";
  const priceAction = `${trendStr} trend · RSI ${row.rsi14} · IV rank ${row.ivRank}%.`;
  const setupDescription = `${row.setupType} — score ${row.opportunityScore}/100 · IV rank ${row.ivRank}%.`;

  return {
    id: hashSymbol(row.symbol),
    symbol:   row.symbol,
    name:     row.name,
    price:    row.price,
    change:   row.change,
    changePercent: row.changePercent,
    volume:   row.volume,
    marketCap: row.marketCap,
    sector:   row.sector,
    technicalStrength: row.technicalStrength,
    fiftyTwoWeekHigh: row.fiftyTwoWeekHigh,
    fiftyTwoWeekLow:  row.fiftyTwoWeekLow,
    eps:  row.eps,
    pe:   row.pe,
    dividendYield: row.dividendYield,
    ivRank: row.ivRank,
    relativeStrength: `${row.technicalStrength}/10`,
    supportPrice:    row.supportPrice,
    resistancePrice: row.resistancePrice,
    earningsDate: row.earningsDate,
    liquidity: row.liquidity,
    priceAction,
    opportunityScore: row.opportunityScore,
    setupType: row.setupType,
    recommendedOutlook: row.recommendedOutlook,
    setupDescription,
    ...(row.etfCategory ? { etfCategory: row.etfCategory } : {}),
    createdAt: new Date(),
  };
}

/** Convert a live Yahoo Finance quote into a Stock response shape (fallback path). */
function quoteToStock(
  quote: Awaited<ReturnType<typeof getQuote>>,
  signals: ReturnType<typeof computeSignals> | null,
  ivRank: number,
  scan: ReturnType<typeof scanOpportunity> | null
) {
  const sig = signals ?? {
    strength: 5,
    trend: "neutral" as const,
    support:    round2(quote.price * 0.94),
    resistance: round2(quote.price * 1.06),
    priceAction: "Neutral trend, insufficient history.",
    relativeStrength: "5/10",
    rsi14: 50,
    sma20:  quote.price,
    sma50:  quote.price,
    sma200: quote.price,
    macd: { value: 0, signal: 0, histogram: 0 },
    atr14: quote.price * 0.015,
    volumeRatio: 1,
  };

  return {
    id: hashSymbol(quote.symbol),
    symbol: quote.symbol,
    name:   quote.name,
    price:  quote.price,
    change: round2(quote.change),
    changePercent: round2(quote.changePercent),
    volume: quote.volume,
    marketCap: quote.marketCap,
    sector: quote.sector,
    technicalStrength: Math.round(sig.strength),
    fiftyTwoWeekHigh:  quote.fiftyTwoWeekHigh,
    fiftyTwoWeekLow:   quote.fiftyTwoWeekLow,
    eps: quote.eps,
    pe:  quote.pe,
    dividendYield: quote.dividendYield,
    ivRank: round2(ivRank),
    relativeStrength: sig.relativeStrength,
    supportPrice:    sig.support,
    resistancePrice: sig.resistance,
    earningsDate: quote.earningsDate,
    liquidity: quote.avgVolume > 1_000_000 ? "Liquid" : "Illiquid",
    priceAction: sig.priceAction,
    opportunityScore: scan?.opportunityScore ?? 40,
    setupType: scan?.setupType ?? "Neutral",
    recommendedOutlook: scan?.recommendedOutlook ?? "neutral",
    setupDescription: scan?.setupDescription ?? "Insufficient data for analysis.",
    createdAt: new Date(),
  };
}

function hashSymbol(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return (h % 999) + 1;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

export default router;
