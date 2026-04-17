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
import { isTastytradeEnabled, getOptionsChain, makeContractLookup } from "../lib/tastytrade.js";

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

    let lookupContract;
    if (isTastytradeEnabled()) {
      try {
        const chain = await getOptionsChain(symbol);
        lookupContract = makeContractLookup(chain);
      } catch { /* fall back to Black-Scholes */ }
    }

    const strategies = buildStrategies(
      symbol,
      quote.price,
      hv.ivRank,
      hv.hv30,
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

    // Build strategies for the requested outlook first, then fall back to all
    let strategy = buildStrategies(symbol, quote.price, hv.ivRank, hv.hv30, signals, requestOutlook)
      .find((s) => s.id === strategyId);

    if (!strategy) {
      for (const ol of ["bullish", "bearish", "neutral"] as const) {
        if (ol === requestOutlook) continue;
        strategy = buildStrategies(symbol, quote.price, hv.ivRank, hv.hv30, signals, ol)
          .find((s) => s.id === strategyId);
        if (strategy) break;
      }
    }

    if (!strategy) {
      res.status(404).json({ error: "Strategy not found" });
      return;
    }

    const iv = impliedVolatility ?? hv.hv30;

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
    res.status(503).json({ error: "Tastytrade not configured" });
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
