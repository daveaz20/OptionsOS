import { Router, type IRouter } from "express";
import {
  isTastytradeEnabled,
  isTastytradeAuthorized,
  getOptionsChain,
  getPositions,
  getAccountBalances,
  type OptionsChain,
  type StreamedGreeks,
} from "../lib/tastytrade.js";

const router: IRouter = Router();

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
    const rawAll = await getPositions();
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

      return {
        id: key,
        underlying,
        strategyType,
        expiration,
        dte,
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
        totalPnl:        Math.round(totalPnl * 100) / 100,
        totalPnlPercent: totalCostBasis !== 0 ? Math.round((totalPnl / totalCostBasis) * 10000) / 100 : 0,
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
      };
    });

    res.json({ positions });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch positions: ${err.message}` });
  }
});

// ─── GET /account/summary ─────────────────────────────────────────────────

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
