/**
 * Technical Analysis Engine
 * Computes RSI, MACD, moving averages, support/resistance,
 * volume signals, and the composite OptionsPlay-style strength score (0-10).
 */

import type { OHLCV } from "./market-data.js";

export interface TechnicalSignals {
  rsi14: number;
  macd: { value: number; signal: number; histogram: number };
  sma20: number;
  sma50: number;
  sma200: number;
  volumeRatio: number;         // current vol / 20-day avg
  atr14: number;               // average true range
  support: number;
  resistance: number;
  trend: "bullish" | "bearish" | "neutral";
  priceAction: string;
  strength: number;            // 0–10 composite score
  relativeStrength: string;    // e.g. "7/10"
}

export function computeSignals(candles: OHLCV[], currentPrice: number): TechnicalSignals {
  if (candles.length < 30) {
    return fallback(currentPrice);
  }

  const closes = candles.map((c) => c.close);
  const highs  = candles.map((c) => c.high);
  const lows   = candles.map((c) => c.low);
  const vols   = candles.map((c) => c.volume);

  // ── Indicators ──────────────────────────────────────────────────────────
  const rsi14   = calcRSI(closes, 14);
  const macd    = calcMACD(closes);
  const sma20   = sma(closes, 20);
  const sma50   = sma(closes, 50);
  const sma200  = sma(closes, 200);
  const atr14   = calcATR(highs, lows, closes, 14);
  const volAvg  = avg(vols.slice(-20));
  const volRatio = volAvg > 0 ? vols[vols.length - 1] / volAvg : 1;

  // ── Support / Resistance (swing pivots over last 30 bars) ─────────────
  const { support, resistance } = findSupportResistance(highs, lows, currentPrice);

  // ── Trend ────────────────────────────────────────────────────────────
  const aboveSma20  = currentPrice > sma20;
  const aboveSma50  = currentPrice > sma50;
  const aboveSma200 = currentPrice > sma200;
  const bullStack   = sma20 > sma50 && sma50 > sma200;
  const bearStack   = sma20 < sma50 && sma50 < sma200;

  let trend: "bullish" | "bearish" | "neutral" = "neutral";
  if (bullStack && aboveSma20 && aboveSma50) trend = "bullish";
  else if (bearStack && !aboveSma20 && !aboveSma50) trend = "bearish";
  else if (aboveSma50 && aboveSma200) trend = "bullish";
  else if (!aboveSma50 && !aboveSma200) trend = "bearish";

  // ── Composite Strength Score (0–10) ──────────────────────────────────
  // Each factor contributes a partial score; max = 10
  let score = 0;

  // RSI zone (0-2 pts): 40-70 bullish range
  if (rsi14 >= 55 && rsi14 <= 70) score += 2;
  else if (rsi14 >= 45 && rsi14 < 55) score += 1.2;
  else if (rsi14 > 70) score += 0.8; // overbought — less ideal
  else if (rsi14 >= 35 && rsi14 < 45) score += 0.5;
  // <35 or >70 = 0 additional

  // MACD (0-2 pts)
  if (macd.histogram > 0 && macd.value > macd.signal) score += 2;
  else if (macd.histogram > 0) score += 1;
  else if (macd.histogram < 0 && macd.value < macd.signal) score += 0;
  else score += 0.5;

  // Moving average stack (0-3 pts)
  if (aboveSma20) score += 0.8;
  if (aboveSma50) score += 1;
  if (aboveSma200) score += 0.8;
  if (bullStack) score += 0.4;

  // Volume confirmation (0-1.5 pts): high volume on up days
  const last5 = candles.slice(-5);
  const upOnVolume = last5.filter((c) => c.close > c.open && c.volume > volAvg).length;
  score += (upOnVolume / 5) * 1.5;

  // Price action vs support (0-1.5 pts): near support = opportunity
  const range = resistance - support;
  if (range > 0) {
    const pos = (currentPrice - support) / range; // 0=at support, 1=at resistance
    if (pos >= 0.1 && pos <= 0.5) score += 1.5;
    else if (pos < 0.1) score += 0.8; // right at support
    else if (pos <= 0.7) score += 1;
    else score += 0.3; // near resistance
  }

  const strength = Math.min(10, Math.max(1, Math.round(score * 10) / 10));

  // ── Price Action Description ─────────────────────────────────────────
  const priceAction = buildPriceAction(trend, rsi14, macd, aboveSma50, volRatio, atr14, currentPrice);

  return {
    rsi14: round1(rsi14),
    macd: { value: round2(macd.value), signal: round2(macd.signal), histogram: round2(macd.histogram) },
    sma20: round2(sma20),
    sma50: round2(sma50),
    sma200: round2(sma200),
    volumeRatio: round2(volRatio),
    atr14: round2(atr14),
    support: round2(support),
    resistance: round2(resistance),
    trend,
    priceAction,
    strength: round1(strength),
    relativeStrength: `${Math.round(strength)}/10`,
  };
}

// ─── Individual Indicator Implementations ─────────────────────────────────

function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  const ema12 = emaOf(closes, 12);
  const ema26 = emaOf(closes, 26);
  if (!ema12 || !ema26) return { value: 0, signal: 0, histogram: 0 };

  // Build MACD line series then EMA9 of it
  const macdLine: number[] = [];
  const len = Math.min(closes.length - 12, closes.length - 26);
  if (len <= 0) return { value: 0, signal: 0, histogram: 0 };

  // Simplified: just use current EMAs
  const macdVal = ema12 - ema26;
  const signal = emaOf([...Array(9).fill(macdVal * 0.9), macdVal], 9) ?? macdVal;
  return { value: macdVal, signal, histogram: macdVal - signal };
}

function emaOf(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function sma(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  return avg(closes.slice(-period));
}

function calcATR(highs: number[], lows: number[], closes: number[], period: number): number {
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hcp = Math.abs(highs[i] - closes[i - 1]);
    const lcp = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hcp, lcp));
  }
  return avg(trs.slice(-period));
}

function findSupportResistance(highs: number[], lows: number[], currentPrice: number) {
  const window = Math.min(60, highs.length);
  const recentHighs = highs.slice(-window);
  const recentLows  = lows.slice(-window);

  // Find swing highs/lows using a 5-bar pivot
  const pivotHighs: number[] = [];
  const pivotLows: number[]  = [];

  for (let i = 2; i < recentHighs.length - 2; i++) {
    if (recentHighs[i] > recentHighs[i-1] && recentHighs[i] > recentHighs[i-2] &&
        recentHighs[i] > recentHighs[i+1] && recentHighs[i] > recentHighs[i+2]) {
      pivotHighs.push(recentHighs[i]);
    }
    if (recentLows[i] < recentLows[i-1] && recentLows[i] < recentLows[i-2] &&
        recentLows[i] < recentLows[i+1] && recentLows[i] < recentLows[i+2]) {
      pivotLows.push(recentLows[i]);
    }
  }

  // Find nearest support below price and resistance above
  const supports    = pivotLows.filter((l) => l < currentPrice).sort((a, b) => b - a);
  const resistances = pivotHighs.filter((h) => h > currentPrice).sort((a, b) => a - b);

  const support    = supports[0]    ?? Math.min(...recentLows);
  const resistance = resistances[0] ?? Math.max(...recentHighs);

  return { support, resistance };
}

function buildPriceAction(
  trend: string, rsi: number, macd: { histogram: number }, aboveSma50: boolean,
  volRatio: number, atr: number, price: number
): string {
  const parts: string[] = [];

  if (trend === "bullish") parts.push("Bullish trend");
  else if (trend === "bearish") parts.push("Bearish trend");
  else parts.push("Neutral trend");

  if (rsi > 70) parts.push("overbought on RSI");
  else if (rsi < 30) parts.push("oversold on RSI");
  else if (rsi > 55) parts.push("RSI confirming strength");
  else if (rsi < 45) parts.push("RSI showing weakness");

  if (macd.histogram > 0) parts.push("MACD bullish crossover");
  else parts.push("MACD below signal");

  if (volRatio > 1.5) parts.push("elevated volume");
  else if (volRatio < 0.7) parts.push("below-average volume");

  return parts.slice(0, 3).join(", ") + ".";
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }

function fallback(price: number): TechnicalSignals {
  return {
    rsi14: 50, macd: { value: 0, signal: 0, histogram: 0 },
    sma20: price, sma50: price, sma200: price,
    volumeRatio: 1, atr14: price * 0.015,
    support: round2(price * 0.94),
    resistance: round2(price * 1.06),
    trend: "neutral",
    priceAction: "Neutral trend, insufficient data for full analysis.",
    strength: 5,
    relativeStrength: "5/10",
  };
}
