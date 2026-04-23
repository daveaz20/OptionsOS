import { Router, type IRouter } from "express";
import { STRATEGY_REGISTRY, getStrategiesForConditions } from "../lib/strategy-registry.js";
import {
  GetStrategiesParams,
  GetStrategiesQueryParams,
  GetStrategiesResponse,
  CalculatePnlParams,
  CalculatePnlBody,
  CalculatePnlResponse,
} from "@workspace/api-zod";
import { getQuote, getPriceHistory, getHistoricalVolatility } from "../lib/market-data.js";
import { computeSignals } from "../lib/technical-analysis.js";
import { buildStrategies, calcPnlCurve } from "../lib/strategy-engine.js";
import { isTastytradeEnabled, isTastytradeAuthorized, getOptionsChain, makeContractLookup, getMarketMetrics } from "../lib/tastytrade.js";

const router: IRouter = Router();

// GET /strategies — returns all 40 strategy definitions
router.get("/strategies", (_req, res) => {
  res.json(STRATEGY_REGISTRY);
});

// GET /strategies/match — match strategies to current market conditions
// Query params: outlook, ivRank, rsi14, technicalScore, momentumScore, hasEarnings
router.get("/strategies/match", (req, res) => {
  const { outlook, ivRank, rsi14, technicalScore, momentumScore, hasEarnings } = req.query;
  const validOutlook = ["bullish", "bearish", "neutral"].includes(outlook as string)
    ? (outlook as "bullish" | "bearish" | "neutral")
    : "neutral";
  const results = getStrategiesForConditions({
    outlook: validOutlook,
    ivRank: Number(ivRank) || 50,
    rsi14: Number(rsi14) || 50,
    technicalScore: Number(technicalScore) || 0,
    momentumScore: Number(momentumScore) || 0,
    hasEarnings: hasEarnings === "true",
  });
  res.json(results);
});

// GET /stocks/:symbol/strategies
router.get("/stocks/:symbol/strategies", async (req, res): Promise<void> => {
  const params = GetStrategiesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const query = GetStrategiesQueryParams.safeParse(req.query);
  const outlook = (query.success ? query.data.outlook : "bullish") ?? "bullish";
  const symbol = (Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol).toUpperCase();

  try {
    const [quote, history, hv] = await Promise.all([
      getQuote(symbol),
      getPriceHistory(symbol, "3M"),
      getHistoricalVolatility(symbol),
    ]);

    const signals = computeSignals(history, quote.price);

    let lookupContract;
    let ivRank = hv.ivRank;
    let hv30   = hv.hv30;
    if (isTastytradeEnabled() && isTastytradeAuthorized()) {
      try {
        const [chain, metricsMap] = await Promise.all([
          getOptionsChain(symbol),
          getMarketMetrics([symbol]),
        ]);
        lookupContract = makeContractLookup(chain);
        const tt = metricsMap.get(symbol);
        if (tt) {
          ivRank = tt.ivRank;
          hv30   = tt.hv30 || hv.hv30;
        }
      } catch { /* fall back to Black-Scholes + HV proxy */ }
    }

    const strategies = buildStrategies(
      symbol,
      quote.price,
      ivRank,
      hv30,
      signals,
      outlook as "bullish" | "bearish" | "neutral",
      lookupContract,
    );

    res.json(GetStrategiesResponse.parse(strategies));
  } catch (err: any) {
    res.status(500).json({ error: `Failed to generate strategies: ${err.message}` });
  }
});

// POST /stocks/:symbol/pnl
router.post("/stocks/:symbol/pnl", async (req, res): Promise<void> => {
  const params = CalculatePnlParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = CalculatePnlBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const symbol = (Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol).toUpperCase();
  const { strategyId, targetPrice, targetDate, impliedVolatility, outlook } = parsed.data;

  try {
    const [quote, history, hv] = await Promise.all([
      getQuote(symbol),
      getPriceHistory(symbol, "3M"),
      getHistoricalVolatility(symbol),
    ]);

    const signals = computeSignals(history, quote.price);

    // Use the outlook from the request — this is the tab the user was viewing.
    // Fall back to searching all outlooks to find the matching strategy ID.
    const requestOutlook = (outlook ?? signals.trend ?? "bullish") as "bullish" | "bearish" | "neutral";

    // Use TT market metrics for accurate IV rank + HV when available
    let ivRankPnl = hv.ivRank;
    let hv30Pnl   = hv.hv30;
    if (isTastytradeEnabled() && isTastytradeAuthorized()) {
      try {
        const metricsMap = await getMarketMetrics([symbol]);
        const tt = metricsMap.get(symbol);
        if (tt) { ivRankPnl = tt.ivRank; hv30Pnl = tt.hv30 || hv.hv30; }
      } catch { /* fall back to HV proxy */ }
    }

    // Build strategies for the requested outlook first, then fall back to all
    let strategy = buildStrategies(symbol, quote.price, ivRankPnl, hv30Pnl, signals, requestOutlook)
      .find((s) => s.id === strategyId);

    if (!strategy) {
      for (const ol of ["bullish", "bearish", "neutral"] as const) {
        if (ol === requestOutlook) continue;
        strategy = buildStrategies(symbol, quote.price, ivRankPnl, hv30Pnl, signals, ol)
          .find((s) => s.id === strategyId);
        if (strategy) break;
      }
    }

    if (!strategy) {
      res.status(404).json({ error: "Strategy not found" });
      return;
    }

    const iv = impliedVolatility || hv.hv30;

    const result = calcPnlCurve(
      strategy.legs as any,
      quote.price,
      targetPrice,
      targetDate,
      iv,
    );

    res.json(CalculatePnlResponse.parse(result));
  } catch (err: any) {
    res.status(500).json({ error: `Failed to calculate P&L: ${err.message}` });
  }
});

// GET /stocks/:symbol/options-chain
router.get("/stocks/:symbol/options-chain", async (req, res): Promise<void> => {
  const params = GetStrategiesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const symbol = (Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol).toUpperCase();

  if (!isTastytradeEnabled()) {
    res.status(503).json({ error: "Tastytrade OAuth credentials not configured" });
    return;
  }
  if (!isTastytradeAuthorized()) {
    res.status(401).json({ error: "Tastytrade not authorized", authUrl: "/api/auth/tastytrade" });
    return;
  }
  try {
    const chain = await getOptionsChain(symbol);
    res.json(chain);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch options chain: ${err.message}` });
  }
});

export default router;
