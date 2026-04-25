import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, stocksTable, userSettingsTable } from "@workspace/db";
import {
  isTastytradeEnabled,
  isTastytradeAuthorized,
  getOptionsChain,
  getPositions,
  getAccountBalances,
  getTransactions,
  type OptionsChain,
  type StreamedGreeks,
} from "../lib/tastytrade.js";

const router: IRouter = Router();

interface PositionDisplaySettings {
  defaultProfitTargetPct: number;
  defaultStopLossPct: number;
  alertPositionProfitTarget: boolean;
  alertPositionStopLoss: boolean;
  closedPositionHistoryDays: number;
  winRateCalculationPeriod: string;
}

async function getPositionDisplaySettings(): Promise<PositionDisplaySettings> {
  const rows = await db.select().from(userSettingsTable);
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
  return {
    defaultProfitTargetPct: Number(settings.defaultProfitTargetPct ?? 50),
    defaultStopLossPct: Number(settings.defaultStopLossPct ?? 100),
    alertPositionProfitTarget: settings.alertPositionProfitTarget !== false,
    alertPositionStopLoss: settings.alertPositionStopLoss !== false,
    closedPositionHistoryDays: Number(settings.closedPositionHistoryDays ?? 30),
    winRateCalculationPeriod: String(settings.winRateCalculationPeriod ?? "90D"),
  };
}

function buildPositionAlerts(totalPnlPercent: number, settings: PositionDisplaySettings) {
  const alerts: Array<{ type: string; label: string; severity: "success" | "danger" | "warning" }> = [];
  if (settings.alertPositionProfitTarget && totalPnlPercent >= settings.defaultProfitTargetPct) {
    alerts.push({ type: "profitTarget", label: "Profit target", severity: "success" });
  }
  if (settings.alertPositionStopLoss && totalPnlPercent <= -Math.abs(settings.defaultStopLossPct)) {
    alerts.push({ type: "stopLoss", label: "Stop loss", severity: "danger" });
  }
  return alerts;
}

function daysSince(dateText: string): number | null {
  const time = Date.parse(dateText);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function winRateWindowStart(period: string): number {
  const now = Date.now();
  if (period === "30D") return now - 30 * 86_400_000;
  if (period === "90D") return now - 90 * 86_400_000;
  if (period === "1Y") return now - 365 * 86_400_000;
  return 0;
}

function isClosingTransaction(action: string, description: string): boolean {
  const text = `${action} ${description}`.toLowerCase();
  return text.includes("close") || text.includes("expiration") || text.includes("assignment") || text.includes("exercise");
}

// ─── OCC symbol parser ─────────────────────────────────────────────────────
// OCC format: "AAPL  250321C00175000"
// Underlying padded to 6 chars, YYMMDD, C/P, strike × 1000 (8 digits)

function parseOcc(symbol: string): { expiration: string; optionType: "call" | "put"; strikePrice: number } | null {
  const m = symbol.replace(/\s+/g, "").match(/^([A-Z1-9.]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, , dateStr, typeChar, strikePad] = m;
  return {
    expiration: `20${dateStr!.slice(0, 2)}-${dateStr!.slice(2, 4)}-${dateStr!.slice(4, 6)}`,
    optionType: typeChar === "C" ? "call" : "put",
    strikePrice: parseInt(strikePad!, 10) / 1000,
  };
}

// ─── Strategy inference ────────────────────────────────────────────────────

interface ParsedLeg {
  symbol: string;
  streamerSymbol: string | null;
  underlying: string;
  optionType: "call" | "put";
  strikePrice: number;
  expiration: string;
  quantity: number;
  direction: "Long" | "Short";
  openPrice: number;
  currentPrice: number;
  livePrice: number | null;
  liveGreeks: StreamedGreeks | null;
  unrealizedPnl: number | null;
  multiplier: number;
  createdAt: string;
}

function inferStrategyType(legs: ParsedLeg[]): string {
  const n = legs.length;
  if (n === 1) {
    const l = legs[0]!;
    if (l.direction === "Long")  return l.optionType === "call" ? "Long Call"  : "Long Put";
    if (l.direction === "Short") return l.optionType === "call" ? "Short Call" : "Short Put";
  }
  if (n === 2) {
    const sorted = [...legs].sort((a, b) => a.strikePrice - b.strikePrice);
    const [a, b] = sorted as [ParsedLeg, ParsedLeg];
    const sameExp  = a.expiration === b.expiration;
    const sameType = a.optionType === b.optionType;
    if (sameExp && sameType) {
      const longLeg  = legs.find(l => l.direction === "Long");
      const shortLeg = legs.find(l => l.direction === "Short");
      if (!longLeg || !shortLeg) return legs.every(l => l.direction === "Short") ? "Short Vertical" : "Long Vertical";
      if (a.optionType === "call") return longLeg.strikePrice < shortLeg.strikePrice ? "Bull Call Spread" : "Bear Call Spread";
      return longLeg.strikePrice > shortLeg.strikePrice ? "Bear Put Spread" : "Bull Put Spread";
    }
    if (sameExp && !sameType) {
      const allShort = legs.every(l => l.direction === "Short");
      const allLong  = legs.every(l => l.direction === "Long");
      const sameStrike = Math.abs(a.strikePrice - b.strikePrice) < 0.01;
      if (allShort) return sameStrike ? "Short Straddle" : "Short Strangle";
      if (allLong)  return sameStrike ? "Long Straddle"  : "Long Strangle";
    }
    if (!sameExp && sameType) {
      if (Math.abs(a.strikePrice - b.strikePrice) < 0.01) return "Calendar Spread";
      return "Diagonal Spread";
    }
  }
  if (n === 4) {
    const calls = legs.filter(l => l.optionType === "call");
    const puts  = legs.filter(l => l.optionType === "put");
    if (calls.length === 2 && puts.length === 2) {
      const cStrikes = calls.map(c => c.strikePrice).sort((x, y) => x - y);
      const pStrikes = puts.map(c => c.strikePrice).sort((x, y) => x - y);
      const atmMatch = Math.abs(cStrikes[0]! - pStrikes[1]!) < 0.01 || Math.abs(cStrikes[1]! - pStrikes[0]!) < 0.01;
      return atmMatch ? "Iron Butterfly" : "Iron Condor";
    }
  }
  return "Custom";
}

// ─── GET /account/balances ─────────────────────────────────────────────────

router.get("/account/balances", async (_req, res): Promise<void> => {
  if (!isTastytradeEnabled()) { res.status(503).json({ error: "Tastytrade OAuth credentials not configured" }); return; }
  if (!isTastytradeAuthorized()) { res.status(401).json({ error: "Tastytrade not authorized", authUrl: "/api/auth/tastytrade" }); return; }
  try {
    const b = await getAccountBalances();
    res.json({
      netLiquidatingValue: b.netLiquidatingValue,
      optionBuyingPower:   b.optionBuyingPower,
      cashBalance:         b.cashBalance,
      dayPnl:              Math.round((b.realizedDayGain + b.unrealizedDayGain) * 100) / 100,
      realizedDayGain:     b.realizedDayGain,
      unrealizedDayGain:   b.unrealizedDayGain,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch balances: ${err.message}` });
  }
});

// ─── GET /account/positions ────────────────────────────────────────────────

router.get("/account/positions", async (_req, res): Promise<void> => {
  if (!isTastytradeEnabled()) { res.status(503).json({ error: "Tastytrade OAuth credentials not configured" }); return; }
  if (!isTastytradeAuthorized()) { res.status(401).json({ error: "Tastytrade not authorized", authUrl: "/api/auth/tastytrade" }); return; }
  try {
    const [rawAll, settings, balances] = await Promise.all([
      getPositions(),
      getPositionDisplaySettings(),
      getAccountBalances().catch(() => null),
    ]);
    const rawOpts = rawAll.filter(p =>
      p.instrumentType === "Equity Option" || p.instrumentType === "Future Option",
    );

    // Parse OCC symbols
    const parsed: ParsedLeg[] = [];
    for (const pos of rawOpts) {
      const occ = parseOcc(pos.symbol);
      if (!occ) continue;
      parsed.push({
        symbol: pos.symbol,
        streamerSymbol: pos.streamerSymbol,
        underlying: pos.underlying,
        optionType: occ.optionType, strikePrice: occ.strikePrice,
        expiration: occ.expiration,
        quantity: pos.quantity, direction: pos.direction,
        openPrice: pos.openPrice,
        currentPrice: pos.currentPrice,
        livePrice: pos.livePrice,
        liveGreeks: pos.liveGreeks,
        unrealizedPnl: pos.unrealizedPnl,
        multiplier: pos.multiplier,
        createdAt: pos.createdAt,
      });
    }

    // Group by underlying + expiration
    const groups = new Map<string, ParsedLeg[]>();
    for (const leg of parsed) {
      const key = `${leg.underlying}::${leg.expiration}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(leg);
    }

    // Fetch chains for greeks (cached 5 min)
    const underlyings = [...new Set(parsed.map(l => l.underlying))];
    const chains = new Map<string, OptionsChain>();
    await Promise.allSettled(underlyings.map(async (sym) => {
      try { chains.set(sym, await getOptionsChain(sym)); } catch { /* greeks unavailable */ }
    }));

    const sectorRows = await Promise.all(underlyings.map(async (sym) => {
      const rows = await db.select({ sector: stocksTable.sector }).from(stocksTable).where(eq(stocksTable.symbol, sym)).limit(1);
      return [sym, rows[0]?.sector ?? "Unclassified"] as const;
    }));
    const sectors = new Map(sectorRows);

    const today = Date.now();

    const positions = Array.from(groups.entries()).map(([key, legs]) => {
      const [underlying, expiration] = key.split("::");
      const dte = Math.max(0, Math.ceil((new Date(expiration!).getTime() - today) / 86_400_000));
      const strategyType = inferStrategyType(legs);
      const sortedStrikes = [...new Set(legs.map(l => l.strikePrice))].sort((a, b) => a - b);

      let totalPnl = 0;
      let totalCostBasis = 0;
      let totalUnrealizedPnl = 0;
      let livePriceAccumulator = 0;
      let livePriceWeight = 0;
      for (const leg of legs) {
        const dir = leg.direction === "Long" ? 1 : -1;
        const effectivePrice = leg.livePrice ?? leg.currentPrice;
        totalPnl += (effectivePrice - leg.openPrice) * dir * leg.quantity * leg.multiplier;
        totalCostBasis += leg.openPrice * leg.quantity * leg.multiplier;
        if (leg.unrealizedPnl != null) totalUnrealizedPnl += leg.unrealizedPnl;
        if (leg.livePrice != null) {
          livePriceAccumulator += leg.livePrice * leg.quantity;
          livePriceWeight += leg.quantity;
        }
      }

      // Greeks from chain
      let delta = 0, gamma = 0, theta = 0, vega = 0, rho = 0, iv = 0;
      let liveGreeksCount = 0;
      const chain = chains.get(underlying!);
      for (const leg of legs) {
        const dir = leg.direction === "Long" ? 1 : -1;
        if (leg.liveGreeks) {
          delta += leg.liveGreeks.delta * dir * leg.quantity;
          gamma += leg.liveGreeks.gamma * dir * leg.quantity;
          theta += leg.liveGreeks.theta * dir * leg.quantity * leg.multiplier;
          vega += leg.liveGreeks.vega * dir * leg.quantity * leg.multiplier;
          rho += leg.liveGreeks.rho * dir * leg.quantity * leg.multiplier;
          iv += leg.liveGreeks.iv;
          liveGreeksCount += 1;
          continue;
        }

        if (!chain) continue;
        const expiry = chain.expirations.find(e => e.expiration === expiration);
        if (!expiry) continue;
        const contract = expiry.contracts.find(
          c => c.optionType === leg.optionType && Math.abs(c.strikePrice - leg.strikePrice) < 0.01,
        );
        if (contract) {
          delta += contract.delta * dir * leg.quantity;
          gamma += contract.gamma * dir * leg.quantity;
          theta += contract.theta * dir * leg.quantity * leg.multiplier;
          vega += contract.vega * dir * leg.quantity * leg.multiplier;
          rho += (contract.rho ?? 0) * dir * leg.quantity * leg.multiplier;
          if (contract.impliedVolatility > 0) {
            iv += contract.impliedVolatility;
            liveGreeksCount += 1;
          }
        }
      }

      const totalPnlRounded = Math.round(totalPnl * 100) / 100;
      const totalPnlPercent = totalCostBasis !== 0 ? Math.round((totalPnl / totalCostBasis) * 10000) / 100 : 0;
      const openedAt = legs.map(leg => leg.createdAt).filter(Boolean).sort()[0] ?? "";
      const daysInTrade = openedAt ? daysSince(openedAt) : null;

      return {
        id: key,
        underlying,
        sector: sectors.get(underlying!) ?? "Unclassified",
        strategyType,
        expiration,
        dte,
        openedAt,
        daysInTrade,
        strikesLabel: sortedStrikes.join("/"),
        legs: legs.map(leg => ({
          symbol: leg.symbol,
          streamerSymbol: leg.streamerSymbol,
          optionType: leg.optionType,
          action: leg.direction.toLowerCase() as "long" | "short",
          strikePrice: leg.strikePrice,
          quantity: leg.quantity,
          openPrice: leg.openPrice,
          currentPrice: leg.currentPrice,
          livePrice: leg.livePrice,
          liveGreeks: leg.liveGreeks,
          unrealizedPnl: leg.unrealizedPnl,
          pnl: Math.round(((leg.livePrice ?? leg.currentPrice) - leg.openPrice) * (leg.direction === "Long" ? 1 : -1) * leg.quantity * leg.multiplier * 100) / 100,
        })),
        totalPnl:        totalPnlRounded,
        totalPnlPercent,
        maxProfitPnlPercent: totalPnlPercent,
        realizedPnl: 0,
        livePrice: livePriceWeight > 0 ? Math.round((livePriceAccumulator / livePriceWeight) * 100) / 100 : null,
        liveGreeks: liveGreeksCount > 0 ? {
          delta: Math.round(delta * 1000) / 1000,
          gamma: Math.round(gamma * 1000) / 1000,
          theta: Math.round(theta * 100) / 100,
          vega: Math.round(vega * 100) / 100,
          rho: Math.round(rho * 100) / 100,
          iv: Math.round((iv / liveGreeksCount) * 100) / 100,
        } : null,
        unrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
        greeks: {
          delta: Math.round(delta * 1000) / 1000,
          gamma: Math.round(gamma * 1000) / 1000,
          theta: Math.round(theta * 100) / 100,
          vega:  Math.round(vega  * 100) / 100,
        },
        alerts: buildPositionAlerts(totalPnlPercent, settings),
      };
    });

    const buyingPowerUsedPct =
      balances && balances.netLiquidatingValue > 0
        ? Math.round(((balances.netLiquidatingValue - balances.optionBuyingPower) / balances.netLiquidatingValue) * 10000) / 100
        : 0;

    res.json({ positions, buyingPowerUsedPct });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch positions: ${err.message}` });
  }
});

// ─── GET /account/summary ─────────────────────────────────────────────────

router.get("/account/position-stats", async (_req, res): Promise<void> => {
  if (!isTastytradeEnabled()) { res.status(503).json({ error: "Tastytrade OAuth credentials not configured" }); return; }
  if (!isTastytradeAuthorized()) { res.status(401).json({ error: "Tastytrade not authorized", authUrl: "/api/auth/tastytrade" }); return; }
  try {
    const settings = await getPositionDisplaySettings();
    const winRateStart = winRateWindowStart(settings.winRateCalculationPeriod);
    const historyStart = Date.now() - settings.closedPositionHistoryDays * 86_400_000;
    const transactions = (await getTransactions(250)).filter((tx) => {
      const executedAt = Date.parse(tx.executedAt);
      if (!Number.isFinite(executedAt) || executedAt < Math.min(winRateStart, historyStart)) return false;
      return isClosingTransaction(tx.action, tx.description);
    });

    const winRateTransactions = transactions.filter((tx) => Date.parse(tx.executedAt) >= winRateStart);
    const closedPositions = transactions.filter((tx) => Date.parse(tx.executedAt) >= historyStart).map((tx) => ({
      id: tx.id,
      symbol: tx.symbol,
      closedAt: tx.executedAt,
      description: tx.description,
      pnl: Math.round(tx.price * tx.quantity * 100) / 100,
    }));
    const winRatePositions = winRateTransactions.map((tx) => Math.round(tx.price * tx.quantity * 100) / 100);
    const wins = winRatePositions.filter((pnl) => pnl > 0).length;
    const losses = winRatePositions.filter((pnl) => pnl < 0).length;
    const totalPnl = closedPositions.reduce((sum, position) => sum + position.pnl, 0);

    res.json({
      period: settings.winRateCalculationPeriod,
      closedPositions,
      totalClosed: winRatePositions.length,
      wins,
      losses,
      winRate: winRatePositions.length > 0 ? Math.round((wins / winRatePositions.length) * 10000) / 100 : 0,
      totalPnl: Math.round(totalPnl * 100) / 100,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to calculate position stats: ${err.message}` });
  }
});

router.get("/account/summary", async (_req, res): Promise<void> => {
  if (!isTastytradeEnabled()) { res.status(503).json({ error: "Tastytrade OAuth credentials not configured" }); return; }
  if (!isTastytradeAuthorized()) { res.status(401).json({ error: "Tastytrade not authorized", authUrl: "/api/auth/tastytrade" }); return; }
  try {
    const [balances, rawAll] = await Promise.all([getAccountBalances(), getPositions()]);
    const rawOpts = rawAll.filter(p =>
      p.instrumentType === "Equity Option" || p.instrumentType === "Future Option",
    );

    // Portfolio theta via chain lookups
    const underlyings = [...new Set(rawOpts.map(p => p.underlying))];
    const chains = new Map<string, OptionsChain>();
    await Promise.allSettled(underlyings.map(async (sym) => {
      try { chains.set(sym, await getOptionsChain(sym)); } catch { /* skip */ }
    }));

    let portfolioTheta = 0;
    for (const pos of rawOpts) {
      const occ = parseOcc(pos.symbol);
      if (!occ) continue;
      const chain = chains.get(pos.underlying);
      if (!chain) continue;
      const expiry = chain.expirations.find(e => e.expiration === occ.expiration);
      if (!expiry) continue;
      const contract = expiry.contracts.find(
        c => c.optionType === occ.optionType && Math.abs(c.strikePrice - occ.strikePrice) < 0.01,
      );
      if (!contract) continue;
      const dir = pos.direction === "Long" ? 1 : -1;
      portfolioTheta += contract.theta * dir * pos.quantity * pos.multiplier;
    }

    res.json({
      netLiquidatingValue: balances.netLiquidatingValue,
      optionBuyingPower:   balances.optionBuyingPower,
      dayPnl:              Math.round((balances.realizedDayGain + balances.unrealizedDayGain) * 100) / 100,
      openPositionsCount:  rawOpts.length,
      portfolioTheta:      Math.round(portfolioTheta * 100) / 100,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch account summary: ${err.message}` });
  }
});

export default router;
