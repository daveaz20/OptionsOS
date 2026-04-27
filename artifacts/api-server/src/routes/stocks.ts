import { Router, type IRouter } from "express";
import {
  GetStockParams,
  GetStockPriceHistoryParams,
  GetStockPriceHistoryQueryParams,
  GetStockPriceHistoryResponse,
  GetStockResponse,
  ListStocksQueryParams,
  ListStocksResponse,
} from "@workspace/api-zod";
import {
  DEFAULT_UNIVERSE,
  getHistoricalVolatility,
  getPriceHistory,
  getQuote,
} from "../lib/market-data.js";
import { chartPeriodToPolygonDays, getPolygonBars, isPolygonEnabled } from "../lib/polygon.js";
import { scanOpportunity } from "../lib/scanner.js";
import { quoteToStock, rankTier, screenerRowToStock } from "../lib/stock-response.js";
import { computeSignals } from "../lib/technical-analysis.js";
import { db, userSettingsTable } from "@workspace/db";
import {
  getMarketMetrics,
  isTastytradeAuthorized,
  isTastytradeEnabled,
} from "../lib/tastytrade.js";
import {
  daysUntilEarnings,
  enrichRowsWithTastytradeQuotes,
  ensureScreenerReady,
  getScreenerData,
  getScreenerRow,
} from "./screener.js";

const router: IRouter = Router();

async function getDefaultChartPeriod(): Promise<string> {
  const rows = await db.select().from(userSettingsTable);
  const period = rows.find((row) => row.key === "defaultChartPeriod")?.value;
  return typeof period === "string" ? period : "1M";
}

async function getIvRankCalculationPeriod(): Promise<string> {
  const rows = await db.select().from(userSettingsTable);
  const period = rows.find((row) => row.key === "ivRankCalculationPeriod")?.value;
  return period === "30D" || period === "60D" || period === "1Y" ? period : "1Y";
}

router.get("/stocks", async (req, res): Promise<void> => {
  const query = ListStocksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { search, limit } = query.data;
  const ivRankCalculationPeriod = await getIvRankCalculationPeriod();

  if (isPolygonEnabled()) {
    await ensureScreenerReady();
    let rows = getScreenerData();

    if (search) {
      const normalized = search.trim().toLowerCase();
      rows = rows.filter(
        (row) =>
          row.symbol.toLowerCase().includes(normalized) ||
          row.name.toLowerCase().includes(normalized),
      );
    }

    const sorted = [...rows].sort((a, b) => b.opportunityScore - a.opportunityScore);
    const limited = limit ? sorted.slice(0, limit) : sorted;
    const liveRows = await enrichRowsWithTastytradeQuotes(limited);
    res.json(ListStocksResponse.parse(liveRows.map(screenerRowToStock)));
    return;
  }

  let universe = [...new Set(DEFAULT_UNIVERSE)];
  if (search) {
    const normalized = search.trim().toLowerCase();
    universe = universe.filter((symbol) => symbol.toLowerCase().includes(normalized));
  }

  const { getQuotes } = await import("../lib/market-data.js");
  const quotes = await getQuotes(universe);

  const concurrency = 8;
  const enriched: ReturnType<typeof quoteToStock>[] = [];
  for (let i = 0; i < quotes.length; i += concurrency) {
    const batch = quotes.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (quote) => {
        try {
          const [history, hv] = await Promise.all([
            getPriceHistory(quote.symbol, "TECH"),
            getHistoricalVolatility(quote.symbol, ivRankCalculationPeriod),
          ]);
          const signals = computeSignals(history, quote.price);
          const dte = daysUntilEarnings(quote.earningsDate);
          const scan = scanOpportunity(
            signals,
            hv.ivRank,
            quote.price,
            quote.changePercent,
            dte,
          );
          return quoteToStock(quote, signals, hv.ivRank, scan);
        } catch {
          return quoteToStock(quote, null, 30, null);
        }
      }),
    );
    enriched.push(...results);
  }

  enriched.sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
  const limited = limit ? enriched.slice(0, limit) : enriched;
  res.json(ListStocksResponse.parse(limited));
});

router.get("/stocks/search", async (req, res): Promise<void> => {
  const rawQuery = typeof req.query.q === "string" ? req.query.q : "";
  const rawLimit =
    typeof req.query.limit === "string"
      ? Number.parseInt(req.query.limit, 10)
      : 10;
  const upper = rawQuery.trim().toUpperCase();
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 25)
    : 10;

  if (!upper) {
    res.json([]);
    return;
  }

  if (isPolygonEnabled()) {
    await ensureScreenerReady();
    const matches = getScreenerData()
      .filter(
        (row) =>
          row.symbol.includes(upper) || row.name.toUpperCase().includes(upper),
      )
      .sort((a, b) => {
        const tierA = rankTier(a.symbol, upper);
        const tierB = rankTier(b.symbol, upper);
        if (tierA !== tierB) return tierA - tierB;
        return b.opportunityScore - a.opportunityScore;
      })
      .slice(0, limit)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        price: row.price,
        score: row.opportunityScore,
        outlook: row.recommendedOutlook,
        isETF: row.isETF,
        etfCategory: row.etfCategory,
      }));

    res.json(matches);
    return;
  }

  const matchedSymbols = [...new Set(DEFAULT_UNIVERSE)]
    .filter((symbol) => symbol.includes(upper))
    .sort((a, b) => rankTier(a, upper) - rankTier(b, upper))
    .slice(0, limit);

  if (matchedSymbols.length === 0) {
    res.json([]);
    return;
  }

  const { getQuotes } = await import("../lib/market-data.js");
  const quotes = await getQuotes(matchedSymbols);
  const results = quotes
    .sort((a, b) => rankTier(a.symbol, upper) - rankTier(b.symbol, upper))
    .map((quote) => ({
      symbol: quote.symbol,
      name: quote.name,
      price: quote.price,
      score: 0,
    }));

  res.json(results);
});

router.get("/stocks/:symbol", async (req, res): Promise<void> => {
  const params = GetStockParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const symbol = (
    Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol
  ).toUpperCase();

  try {
    if (isPolygonEnabled()) {
      const cached = getScreenerRow(symbol);
      if (cached) {
        const [liveRow] = await enrichRowsWithTastytradeQuotes([cached], { waitForLiveMs: 1200 });
        res.json(GetStockResponse.parse(screenerRowToStock(liveRow ?? cached)));
        return;
      }
    }

    const ivRankCalculationPeriod = await getIvRankCalculationPeriod();
    const [quote, history, hv] = await Promise.all([
      getQuote(symbol),
      getPriceHistory(symbol, "TECH"),
      getHistoricalVolatility(symbol, ivRankCalculationPeriod),
    ]);

    const signals = computeSignals(history, quote.price);
    const dte = daysUntilEarnings(quote.earningsDate);
    let ivRank = hv.ivRank;

    if (isTastytradeEnabled() && isTastytradeAuthorized()) {
      try {
        const metrics = await getMarketMetrics([symbol]);
        const tastytradeMetrics = metrics.get(symbol);
        if (tastytradeMetrics) ivRank = tastytradeMetrics.ivRank;
      } catch {
        // Fall back to the historical-volatility proxy.
      }
    }

    const scan = scanOpportunity(
      signals,
      ivRank,
      quote.price,
      quote.changePercent,
      dte,
    );
    res.json(GetStockResponse.parse(quoteToStock(quote, signals, ivRank, scan)));
  } catch {
    res.status(404).json({ error: `Symbol not found: ${symbol}` });
  }
});

router.get("/stocks/:symbol/price-history", async (req, res): Promise<void> => {
  const params = GetStockPriceHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const symbol = (
    Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol
  ).toUpperCase();

  try {
    const query = GetStockPriceHistoryQueryParams.safeParse(req.query);
    const period = query.success && req.query.period ? query.data.period : await getDefaultChartPeriod();
    const history = isPolygonEnabled()
      ? (await getPolygonBars(symbol, chartPeriodToPolygonDays(period))).map((bar) => ({
          date: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        }))
      : await getPriceHistory(symbol, period);
    res.json(GetStockPriceHistoryResponse.parse(history));
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch price history: ${err.message}` });
  }
});

export default router;
