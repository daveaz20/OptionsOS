import type { getQuote } from "./market-data.js";
import type { computeSignals } from "./technical-analysis.js";
import type { scanOpportunity } from "./scanner.js";
import type { ScreenerRow } from "../routes/screener.js";

export function rankTier(symbol: string, upper: string): number {
  if (symbol === upper) return 0;
  if (symbol.startsWith(upper)) return 1;
  if (symbol.includes(upper)) return 2;
  return 3;
}

export function screenerRowToStock(row: ScreenerRow) {
  const outlook = row.recommendedOutlook as "bullish" | "bearish" | "neutral";
  const trendStr =
    outlook === "bullish"
      ? "Bullish"
      : outlook === "bearish"
        ? "Bearish"
        : "Neutral";

  return {
    id: hashSymbol(row.symbol),
    symbol: row.symbol,
    name: row.name,
    price: row.price,
    change: row.change,
    changePercent: row.changePercent,
    volume: row.volume,
    marketCap: row.marketCap,
    sector: row.sector,
    technicalStrength: row.technicalStrength,
    fiftyTwoWeekHigh: row.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: row.fiftyTwoWeekLow,
    eps: row.eps,
    pe: row.pe,
    dividendYield: row.dividendYield / 100,
    ivRank: row.ivRank,
    relativeStrength: `${row.technicalStrength}/10`,
    supportPrice: row.supportPrice,
    resistancePrice: row.resistancePrice,
    earningsDate: row.earningsDate,
    liquidity: row.liquidity,
    priceAction: `${trendStr} trend · RSI ${row.rsi14} · IV rank ${row.ivRank}%.`,
    opportunityScore: row.opportunityScore,
    setupType: row.setupType,
    recommendedOutlook: row.recommendedOutlook,
    setupDescription: `${row.setupType} — score ${row.opportunityScore}/100 · IV rank ${row.ivRank}%.`,
    topStrategies: row.topStrategies,
    ...(row.isETF ? { isETF: true } : {}),
    ...(row.etfCategory ? { etfCategory: row.etfCategory } : {}),
    createdAt: new Date(),
  };
}

export function quoteToStock(
  quote: Awaited<ReturnType<typeof getQuote>>,
  signals: ReturnType<typeof computeSignals> | null,
  ivRank: number,
  scan: ReturnType<typeof scanOpportunity> | null,
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
    opportunityScore: scan?.opportunityScore ?? 25,
    setupType: scan?.setupType ?? "Neutral",
    recommendedOutlook: scan?.recommendedOutlook ?? "neutral",
    setupDescription: scan?.setupDescription ?? "Insufficient data for analysis.",
    topStrategies: scan?.topStrategies ?? [],
    createdAt: new Date(),
  };
}

function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) & 0x7fffffff;
  }
  return (hash % 999) + 1;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
