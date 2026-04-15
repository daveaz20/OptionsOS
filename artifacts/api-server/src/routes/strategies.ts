import { Router, type IRouter } from "express";
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

const router: IRouter = Router();

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

    const strategies = buildStrategies(
      symbol,
      quote.price,
      hv.ivRank,
      hv.hv30,         // HV30 as IV proxy (percentage)
      signals,
      outlook as "bullish" | "bearish" | "neutral"
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
  const { strategyId, targetPrice, targetDate, impliedVolatility } = parsed.data;

  try {
    const [quote, history, hv] = await Promise.all([
      getQuote(symbol),
      getPriceHistory(symbol, "3M"),
      getHistoricalVolatility(symbol),
    ]);

    const signals = computeSignals(history, quote.price);
    const outlook = signals.trend === "bullish" ? "bullish" : signals.trend === "bearish" ? "bearish" : "neutral";

    // Rebuild strategies to find the selected one
    const strategies = buildStrategies(symbol, quote.price, hv.ivRank, hv.hv30, signals, outlook as any);
    const strategy = strategies.find((s) => s.id === strategyId) ?? strategies[0];

    if (!strategy) {
      res.status(404).json({ error: "Strategy not found" });
      return;
    }

    const result = calcPnlCurve(
      strategy.legs as any,
      quote.price,
      targetDate,
      impliedVolatility ?? hv.hv30,
    );

    res.json(CalculatePnlResponse.parse(result));
  } catch (err: any) {
    res.status(500).json({ error: `Failed to calculate P&L: ${err.message}` });
  }
});

export default router;
