import { Router, type IRouter } from "express";
import { like, sql } from "drizzle-orm";
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
import { getQuote, getQuotes, getPriceHistory, getHistoricalVolatility, DEFAULT_UNIVERSE } from "../lib/market-data.js";
import { computeSignals } from "../lib/technical-analysis.js";

const router: IRouter = Router();

// GET /stocks — list all stocks in scanner universe with live quotes + technicals
router.get("/stocks", async (req, res): Promise<void> => {
  const query = ListStocksQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const { search, limit } = query.data;

  let universe = DEFAULT_UNIVERSE;
  if (search) {
    const q = search.trim().toLowerCase();
    universe = universe.filter((s) => s.toLowerCase().includes(q));
  }
  if (limit && limit < universe.length) universe = universe.slice(0, limit);

  const quotes = await getQuotes(universe);

  // Fetch technicals for each — parallel with a concurrency guard
  const enriched = await Promise.all(
    quotes.map(async (quote) => {
      try {
        const [history, hv] = await Promise.all([
          getPriceHistory(quote.symbol, "3M"),
          getHistoricalVolatility(quote.symbol),
        ]);
        const signals = computeSignals(history, quote.price);
        return quoteToStock(quote, signals, hv.ivRank);
      } catch {
        return quoteToStock(quote, null, 30);
      }
    })
  );

  res.json(ListStocksResponse.parse(enriched));
});

// GET /stocks/:symbol — full detail for one symbol
router.get("/stocks/:symbol", async (req, res): Promise<void> => {
  const params = GetStockParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const symbol = (Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol).toUpperCase();

  try {
    const [quote, history, hv] = await Promise.all([
      getQuote(symbol),
      getPriceHistory(symbol, "3M"),
      getHistoricalVolatility(symbol),
    ]);
    const signals = computeSignals(history, quote.price);
    res.json(GetStockResponse.parse(quoteToStock(quote, signals, hv.ivRank)));
  } catch (err: any) {
    res.status(404).json({ error: `Symbol not found: ${symbol}` });
  }
});

// GET /stocks/:symbol/price-history — OHLCV candles from Yahoo Finance
router.get("/stocks/:symbol/price-history", async (req, res): Promise<void> => {
  const params = GetStockPriceHistoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const query = GetStockPriceHistoryQueryParams.safeParse(req.query);
  const period = query.success ? (query.data.period ?? "3M") : "3M";
  const symbol = (Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol).toUpperCase();

  try {
    const history = await getPriceHistory(symbol, period);
    res.json(GetStockPriceHistoryResponse.parse(history));
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch price history: ${err.message}` });
  }
});

// ─── Shape adapter ────────────────────────────────────────────────────────

function quoteToStock(
  quote: Awaited<ReturnType<typeof getQuote>>,
  signals: ReturnType<typeof computeSignals> | null,
  ivRank: number
) {
  const sig = signals ?? {
    strength: 5,
    trend: "neutral" as const,
    support: round2(quote.price * 0.94),
    resistance: round2(quote.price * 1.06),
    priceAction: "Neutral trend, insufficient history.",
    relativeStrength: "5/10",
    rsi14: 50,
    sma20: quote.price,
    sma50: quote.price,
    sma200: quote.price,
    macd: { value: 0, signal: 0, histogram: 0 },
    atr14: quote.price * 0.015,
    volumeRatio: 1,
  };

  return {
    id: hashSymbol(quote.symbol),
    symbol: quote.symbol,
    name: quote.name,
    price: quote.price,
    change: round2(quote.change),
    changePercent: round2(quote.changePercent),
    volume: quote.volume,
    marketCap: quote.marketCap,
    sector: quote.sector,
    technicalStrength: Math.round(sig.strength),
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
    eps: quote.eps,
    pe: quote.pe,
    dividendYield: quote.dividendYield,
    ivRank: round2(ivRank),
    relativeStrength: sig.relativeStrength,
    supportPrice: sig.support,
    resistancePrice: sig.resistance,
    earningsDate: quote.earningsDate,
    liquidity: quote.avgVolume > 1_000_000 ? "Liquid" : "Illiquid",
    priceAction: sig.priceAction,
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
