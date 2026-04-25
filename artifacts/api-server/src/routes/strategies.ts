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
import {
  buildStrategies,
  calcPnlCurve,
  DEFAULT_PNL_CALCULATION_SETTINGS,
  DEFAULT_STRATEGY_RISK_PREFERENCES,
  type PnlCalculationSettings,
  type StrategyRiskPreferences,
} from "../lib/strategy-engine.js";
import { isTastytradeEnabled, isTastytradeAuthorized, getOptionsChain, makeContractLookup, getMarketMetrics } from "../lib/tastytrade.js";
import { db, userSettingsTable } from "@workspace/db";

const router: IRouter = Router();

async function getRiskPreferences(): Promise<StrategyRiskPreferences> {
  const rows = await db.select().from(userSettingsTable);
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
  return {
    riskMinDTE: typeof values.minDTE === "number" ? values.minDTE : typeof values.riskMinDTE === "number" ? values.riskMinDTE : DEFAULT_STRATEGY_RISK_PREFERENCES.riskMinDTE,
    riskMaxDTE: typeof values.maxDTE === "number" ? values.maxDTE : typeof values.riskMaxDTE === "number" ? values.riskMaxDTE : DEFAULT_STRATEGY_RISK_PREFERENCES.riskMaxDTE,
  };
}

function numberSetting(values: Record<string, unknown>, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanSetting(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = values[key];
  return typeof value === "boolean" ? value : fallback;
}

async function getPnlPreferences(): Promise<{ riskFreeRate: number; settings: PnlCalculationSettings; defaultContracts: number }> {
  const rows = await db.select().from(userSettingsTable);
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
  return {
    riskFreeRate: numberSetting(values, "riskFreeRatePct", 4.5) / 100,
    defaultContracts: Math.max(1, Math.floor(numberSetting(values, "defaultContracts", 1))),
    settings: {
      commissionPerContract: numberSetting(values, "commissionPerContract", DEFAULT_PNL_CALCULATION_SETTINGS.commissionPerContract),
      perLegCommission: numberSetting(values, "perLegCommission", DEFAULT_PNL_CALCULATION_SETTINGS.perLegCommission),
      exchangeFeePerContract: numberSetting(values, "exchangeFeePerContract", DEFAULT_PNL_CALCULATION_SETTINGS.exchangeFeePerContract),
      includeCommissionsInPnl: booleanSetting(values, "includeCommissionsInPnl", DEFAULT_PNL_CALCULATION_SETTINGS.includeCommissionsInPnl),
      includeFeesInBreakeven: booleanSetting(values, "includeFeesInBreakeven", DEFAULT_PNL_CALCULATION_SETTINGS.includeFeesInBreakeven),
      contractMultiplier: Math.max(1, Math.floor(numberSetting(values, "contractMultiplier", DEFAULT_PNL_CALCULATION_SETTINGS.contractMultiplier))),
      pnlCurveResolution: Math.max(10, Math.floor(numberSetting(values, "pnlCurveResolution", DEFAULT_PNL_CALCULATION_SETTINGS.pnlCurveResolution))),
    },
  };
}

async function getGreeksPreferences(): Promise<{
  ivRankCalculationPeriod: string;
  minOpenInterest: number;
  minVolume: number;
  filterIlliquid: boolean;
}> {
  const rows = await db.select().from(userSettingsTable);
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
  const period = values.ivRankCalculationPeriod;
  return {
    ivRankCalculationPeriod: period === "30D" || period === "60D" || period === "1Y" ? period : "1Y",
    minOpenInterest: Math.max(0, Math.floor(numberSetting(values, "minOpenInterest", 100))),
    minVolume: Math.max(0, Math.floor(numberSetting(values, "minContractVolume", 10))),
    filterIlliquid: booleanSetting(values, "filterIlliquidOptionsAutomatically", true),
  };
}

// GET /stocks/:symbol/strategies
router.get("/stocks/:symbol/strategies", async (req, res): Promise<void> => {
  const params = GetStrategiesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const query = GetStrategiesQueryParams.safeParse(req.query);
  const outlook = (query.success ? query.data.outlook : "bullish") ?? "bullish";
  const symbol = (Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol).toUpperCase();

  try {
    const greeksPreferences = await getGreeksPreferences();
    const [quote, history, hv, riskPreferences] = await Promise.all([
      getQuote(symbol),
      getPriceHistory(symbol, "3M"),
      getHistoricalVolatility(symbol, greeksPreferences.ivRankCalculationPeriod),
      getRiskPreferences(),
    ]);

    const signals = computeSignals(history, quote.price);

    let lookupContract;
    let ivRank = hv.ivRank;
    let hv30   = hv.hv30;
    if (isTastytradeEnabled() && isTastytradeAuthorized()) {
      try {
        const [chain, metricsMap] = await Promise.all([
          getOptionsChain(symbol, greeksPreferences),
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
      riskPreferences,
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
    const greeksPreferences = await getGreeksPreferences();
    const [quote, history, hv, riskPreferences, pnlPreferences] = await Promise.all([
      getQuote(symbol),
      getPriceHistory(symbol, "3M"),
      getHistoricalVolatility(symbol, greeksPreferences.ivRankCalculationPeriod),
      getRiskPreferences(),
      getPnlPreferences(),
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
    let strategy = buildStrategies(symbol, quote.price, ivRankPnl, hv30Pnl, signals, requestOutlook, undefined, riskPreferences)
      .find((s) => s.id === strategyId);

    if (!strategy) {
      for (const ol of ["bullish", "bearish", "neutral"] as const) {
        if (ol === requestOutlook) continue;
        strategy = buildStrategies(symbol, quote.price, ivRankPnl, hv30Pnl, signals, ol, undefined, riskPreferences)
          .find((s) => s.id === strategyId);
        if (strategy) break;
      }
    }

    if (!strategy) {
      res.status(404).json({ error: "Strategy not found" });
      return;
    }

    strategy = {
      ...strategy,
      legs: strategy.legs.map((leg) => ({ ...leg, quantity: leg.quantity * pnlPreferences.defaultContracts })),
    };

    const iv = impliedVolatility || hv.hv30;

    const result = calcPnlCurve(
      strategy.legs as any,
      quote.price,
      targetPrice,
      targetDate,
      iv,
      pnlPreferences.riskFreeRate,
      pnlPreferences.settings,
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
    const greeksPreferences = await getGreeksPreferences();
    const chain = await getOptionsChain(symbol, greeksPreferences);
    res.json(chain);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch options chain: ${err.message}` });
  }
});

export default router;
