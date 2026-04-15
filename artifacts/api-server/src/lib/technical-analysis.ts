/**
 * Technical Analysis Engine
 * Computes RSI (Wilder's), MACD (proper EMA series), moving averages,
 * support/resistance, volume signals, and the composite strength score (0–10).
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
  const rsi14  = calcRSI(closes, 14);
  const macd   = calcMACD(closes);
  const sma20  = sma(closes, 20);
  const sma50  = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const atr14  = calcATR(highs, lows, closes, 14);
  const volAvg = avg(vols.slice(-20));
  const volRatio = volAvg > 0 ? vols[vols.length - 1] / volAvg : 1;

  // ── Support / Resistance (swing pivots over last 60 bars) ─────────────
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
  let score = 0;

  // RSI zone (0–2 pts): 40–70 bullish range
  if (rsi14 >= 55 && rsi14 <= 70) score += 2;
  else if (rsi14 >= 45 && rsi14 < 55) score += 1.2;
  else if (rsi14 > 70) score += 0.8;
  else if (rsi14 >= 35 && rsi14 < 45) score += 0.5;

  // MACD (0–2 pts)
  if (macd.histogram > 0 && macd.value > macd.signal) score += 2;
  else if (macd.histogram > 0) score += 1;
  else if (macd.histogram < 0 && macd.value < macd.signal) score += 0;
  else score += 0.5;

  // Moving average stack (0–3 pts)
  if (aboveSma20)  score += 0.8;
  if (aboveSma50)  score += 1;
  if (aboveSma200) score += 0.8;
  if (bullStack)   score += 0.4;

  // Volume confirmation (0–1.5 pts): high volume on up days
  const last5 = candles.slice(-5);
  const upOnVolume = last5.filter((c) => c.close > c.open && c.volume > volAvg).length;
  score += (upOnVolume / 5) * 1.5;

  // Price action vs support (0–1.5 pts): near support = opportunity
  const range = resistance - support;
  if (range > 0) {
    const pos = (currentPrice - support) / range;
    if (pos >= 0.1 && pos <= 0.5) score += 1.5;
    else if (pos < 0.1) score += 0.8;
    else if (pos <= 0.7) score += 1;
    else score += 0.3;
  }

  const strength = Math.min(10, Math.max(1, Math.round(score * 10) / 10));

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

// ─── RSI — Wilder's Smoothed Moving Average (industry standard) ───────────────

function calcRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  // Seed: simple average of first `period` changes
  let sumGain = 0, sumLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) sumGain += diff; else sumLoss -= diff;
  }
  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;

  // Wilder's smoothing for the remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── MACD — proper EMA(12,26,9) implementation ────────────────────────────────

function calcMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  if (closes.length < 35) return { value: 0, signal: 0, histogram: 0 };

  const ema12 = emaSeries(closes, 12); // length: closes.length - 11
  const ema26 = emaSeries(closes, 26); // length: closes.length - 25

  // Align: offset ema12 so indices match ema26
  const offset = ema12.length - ema26.length; // = 14
  const macdLine = ema26.map((e26, i) => ema12[i + offset]! - e26);

  if (macdLine.length < 9) {
    const v = macdLine[macdLine.length - 1] ?? 0;
    return { value: v, signal: v, histogram: 0 };
  }

  const signalLine = emaSeries(macdLine, 9);

  const value  = macdLine[macdLine.length - 1]!;
  const signal = signalLine[signalLine.length - 1]!;

  return { value, signal, histogram: value - signal };
}

// Incremental EMA series (returns array of EMA values starting from bar `period`)
function emaSeries(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result.push(ema);
  for (let i = period; i < data.length; i++) {
    ema = data[i]! * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ─── Moving average ────────────────────────────────────────────────────────────

function sma(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  return avg(closes.slice(-period));
}

// ─── ATR ──────────────────────────────────────────────────────────────────────

function calcATR(highs: number[], lows: number[], closes: number[], period: number): number {
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const hl  = highs[i]! - lows[i]!;
    const hcp = Math.abs(highs[i]! - closes[i - 1]!);
    const lcp = Math.abs(lows[i]!  - closes[i - 1]!);
    trs.push(Math.max(hl, hcp, lcp));
  }
  return avg(trs.slice(-period));
}

// ─── Support / Resistance (5-bar swing pivots) ────────────────────────────────

function findSupportResistance(highs: number[], lows: number[], currentPrice: number) {
  const window = Math.min(60, highs.length);
  const recentHighs = highs.slice(-window);
  const recentLows  = lows.slice(-window);

  const pivotHighs: number[] = [];
  const pivotLows:  number[] = [];

  for (let i = 2; i < recentHighs.length - 2; i++) {
    if (
      recentHighs[i]! > recentHighs[i - 1]! && recentHighs[i]! > recentHighs[i - 2]! &&
      recentHighs[i]! > recentHighs[i + 1]! && recentHighs[i]! > recentHighs[i + 2]!
    ) pivotHighs.push(recentHighs[i]!);

    if (
      recentLows[i]! < recentLows[i - 1]! && recentLows[i]! < recentLows[i - 2]! &&
      recentLows[i]! < recentLows[i + 1]! && recentLows[i]! < recentLows[i + 2]!
    ) pivotLows.push(recentLows[i]!);
  }

  const supports    = pivotLows.filter((l) => l < currentPrice).sort((a, b) => b - a);
  const resistances = pivotHighs.filter((h) => h > currentPrice).sort((a, b) => a - b);

  const support    = supports[0]    ?? Math.min(...recentLows);
  const resistance = resistances[0] ?? Math.max(...recentHighs);

  return { support, resistance };
}

// ─── Price action description ─────────────────────────────────────────────────

function buildPriceAction(
  trend: string, rsi: number, macd: { histogram: number; value: number },
  aboveSma50: boolean, volRatio: number, atr: number, price: number
): string {
  const parts: string[] = [];

  if (trend === "bullish") parts.push("Bullish trend");
  else if (trend === "bearish") parts.push("Bearish trend");
  else parts.push("Consolidating");

  if (rsi > 70) parts.push("overbought RSI");
  else if (rsi < 30) parts.push("oversold RSI");
  else if (rsi > 58) parts.push("RSI confirming momentum");
  else if (rsi < 42) parts.push("RSI showing weakness");

  if (macd.histogram > 0 && macd.value > 0) parts.push("MACD bullish");
  else if (macd.histogram < 0 && macd.value < 0) parts.push("MACD bearish");
  else if (macd.histogram > 0) parts.push("MACD turning bullish");
  else parts.push("MACD turning bearish");

  if (volRatio > 1.5) parts.push("elevated volume");
  else if (volRatio < 0.7) parts.push("low volume");

  return parts.slice(0, 3).join(", ") + ".";
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }

function fallback(price: number): TechnicalSignals {
  return {
    rsi14: 50,
    macd: { value: 0, signal: 0, histogram: 0 },
    sma20: price, sma50: price, sma200: price,
    volumeRatio: 1,
    atr14: price * 0.015,
    support: round2(price * 0.94),
    resistance: round2(price * 1.06),
    trend: "neutral",
    priceAction: "Insufficient data for full technical analysis.",
    strength: 5,
    relativeStrength: "5/10",
  };
}
