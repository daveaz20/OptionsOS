/**
 * Options Opportunity Scanner
 *
 * Evaluates each stock on four criteria and produces an actionable scan result:
 *
 * 1. Technical setup quality   (0–35 pts) — RSI, MACD, MA stack, trend confirmation
 * 2. IV alignment              (0–25 pts) — is IV rank high/low for the suggested strategy type?
 * 3. Entry quality             (0–25 pts) — is price at a good entry (near support/resistance)?
 * 4. Momentum confirmation     (0–15 pts) — volume, recent candle direction, ATR expansion
 *
 * Total: 0–100. Scores >= 60 = high-conviction setup.
 *
 * Setup types map to OptionsPlay strategy matrix:
 *   Bullish + IV low/med  → "Call Spread" or "Long Call"
 *   Bullish + IV high     → "Bull Put Spread" (sell credit)
 *   Bearish + IV low/med  → "Bear Put Spread" or "Long Put"
 *   Bearish + IV high     → "Bear Call Spread" (sell credit)
 *   Neutral + IV very high → "Iron Condor"
 *   Neutral + IV very low  → "Straddle"
 *   Bullish + IV high + trending → "Covered Call"
 */

import type { TechnicalSignals } from "./technical-analysis.js";
import { STRATEGY_REGISTRY, getStrategiesForConditions } from "./strategy-registry.js";

// Internal type used only within this file for legacy scoring functions
type LegacySetup =
  | "Bull Put Spread"
  | "Call Spread"
  | "Long Call"
  | "Covered Call"
  | "Bear Call Spread"
  | "Bear Put Spread"
  | "Long Put"
  | "Iron Condor"
  | "Straddle"
  | "Calendar"
  | "Neutral";

export type SetupType = typeof STRATEGY_REGISTRY[number]['id'];

export type ScanOutlook = "bullish" | "bearish" | "neutral";

export interface TopStrategy {
  id: string;
  name: string;
  fitScore: number;
  fitReason: string;
  tier: string;
  url: string;
}

export interface ScanResult {
  opportunityScore: number;     // 0–100 (clamped from 0–110)
  setupType: SetupType;
  recommendedOutlook: ScanOutlook;
  setupDescription: string;
  technicalScore: number;       // 0–35
  ivScore: number;              // 0–25
  entryScore: number;           // 0–25
  momentumScore: number;        // 0–15
  vwapScore: number;            // 0–10
  topStrategies: TopStrategy[];
}

export interface ScanOpts {
  isETF?: boolean;
  etfCategory?: "leveraged-bull" | "leveraged-bear" | "leveraged-single" | "sector";
}

export function scanOpportunity(
  signals: TechnicalSignals,
  ivRank: number,
  price: number,
  changePercent: number,
  daysToEarnings?: number,   // undefined = unknown, 0 = today/past
  dayVwap = 0,               // today's VWAP from Polygon snapshot (0 = unavailable)
  prevDayVwap = 0,           // previous day's VWAP from Polygon snapshot
  opts?: ScanOpts,
): ScanResult {
  const isETF      = opts?.isETF ?? false;
  const etfCat     = opts?.etfCategory;
  // Capture ivRank for registry matching later
  const ivRankValue = ivRank;

  // ── 1. Determine directional outlook ────────────────────────────────────
  let outlook = determineOutlook(signals, ivRank);
  // Leveraged ETFs are directional by design — lock in their intended direction
  if (etfCat === "leveraged-bull") outlook = "bullish";
  if (etfCat === "leveraged-bear") outlook = "bearish";
  // leveraged-single: don't force outlook — let technicals decide direction

  // ── 2. Choose the best setup for this outlook + IV environment ───────────
  let setup: LegacySetup = chooseSetup(outlook, ivRank, signals);

  // Restrict leveraged/single-stock ETF setups to directional strategies only.
  // Covered Calls require owning shares (not applicable to ETF options).
  if (isETF) setup = restrictETFSetup(setup, etfCat, outlook, ivRank);

  // ETFs have no earnings — skip earnings-proximity adjustments to ivScore
  const effectiveDte = isETF ? undefined : daysToEarnings;

  // ── 3. Score each dimension ──────────────────────────────────────────────
  const rawTechnical = scoreTechnical(signals, outlook);
  const rawIv        = scoreIvAlignment(ivRank, setup, effectiveDte);
  const entryScore   = scoreEntryQuality(signals, price, outlook);
  const rawMomentum  = scoreMomentum(signals, changePercent, outlook, price);
  const vwapScore    = scoreVwap(price, dayVwap, prevDayVwap, outlook);

  // ETF weight adjustments: technical +5, momentum +5, IV −5
  // Rationale: ETFs have cleaner trend signals and no earnings risk, but IV rank
  // is less meaningful (no single-stock vol events).
  const techAdj = isETF ? 5 : 0;
  const momAdj  = isETF ? 5 : 0;
  const ivAdj   = isETF ? -5 : 0;

  const technicalScore = rawTechnical + techAdj;
  const ivScore        = Math.max(0, rawIv + ivAdj);
  const momentumScore  = rawMomentum + momAdj;

  const total = Math.round(technicalScore + ivScore + entryScore + momentumScore + vwapScore);

  // ── Hard gates: ensure ALL key dimensions meet a minimum bar ───────────────
  // A setup with a great score in two areas but weak in others isn't actionable.
  // These gates prevent marginal multi-dimension stacks from appearing as setups.
  let cappedScore = total;
  let cappedSetup: LegacySetup = setup;
  let cappedOutlook: ScanOutlook = outlook;

  const dimensionsFailing =
    (technicalScore < 18 ? 1 : 0) +   // must have real technical conviction (≥18/35)
    (ivScore        < 10 ? 1 : 0) +   // IV must be in the right regime (≥10/25)
    (entryScore     < 12 ? 1 : 0) +   // must be near a meaningful level (≥12/25)
    (momentumScore  <  5 ? 1 : 0);    // must have at least mild confirmation (≥5/15)

  if (dimensionsFailing >= 2) {
    // Two or more weak dimensions = no actionable setup
    cappedScore   = Math.min(cappedScore, 44);
    cappedSetup   = "Neutral";
    cappedOutlook = "neutral";
  } else if (dimensionsFailing === 1) {
    // One weak dimension: marginal setup — cap at 62
    cappedScore = Math.min(cappedScore, 62);
  }

  const opportunityScore = Math.max(0, Math.min(100, cappedScore));

  // Use the registry to find the best-fit strategies for this stock's conditions
  const registryMatches = getStrategiesForConditions({
    outlook: cappedOutlook,
    ivRank: ivRankValue,
    rsi14: signals.rsi14 ?? 50,
    technicalScore: Math.round(technicalScore),
    momentumScore: Math.round(momentumScore),
    hasEarnings: daysToEarnings !== undefined && daysToEarnings <= 14,
  });

  const topStrategies: TopStrategy[] = registryMatches.slice(0, 5).map(s => ({
    id: s.id,
    name: s.name,
    fitScore: s.fitScore,
    fitReason: s.fitReason,
    tier: s.tier,
    url: s.url,
  }));

  const setupType: SetupType = registryMatches[0]?.id ?? 'long_call';

  return {
    opportunityScore,
    setupType,
    recommendedOutlook: cappedOutlook,
    setupDescription: buildDescription(cappedSetup, cappedOutlook, ivRankValue, signals, effectiveDte),
    technicalScore: Math.round(technicalScore),
    ivScore: Math.round(ivScore),
    entryScore: Math.round(entryScore),
    momentumScore: Math.round(momentumScore),
    vwapScore: Math.round(vwapScore),
    topStrategies,
  };
}

// ─── Outlook determination ─────────────────────────────────────────────────
// Weights: trend > RSI zone > MACD histogram > MA stack

function determineOutlook(signals: TechnicalSignals, ivRank: number): ScanOutlook {
  let bullScore = 0;
  let bearScore = 0;

  // Trend (strongest signal)
  if (signals.trend === "bullish") bullScore += 3;
  if (signals.trend === "bearish") bearScore += 3;

  // RSI
  if (signals.rsi14 > 55 && signals.rsi14 < 75) bullScore += 2;
  if (signals.rsi14 < 45 && signals.rsi14 > 25) bearScore += 2;
  if (signals.rsi14 >= 75) bullScore += 0.5;  // overbought, less conviction
  if (signals.rsi14 <= 25) bearScore += 0.5;  // oversold, potential bounce

  // MACD
  if (signals.macd.histogram > 0) bullScore += 2;
  if (signals.macd.histogram < 0) bearScore += 2;

  // Moving average confirmation
  if (signals.sma20 > signals.sma50) bullScore += 1;
  if (signals.sma20 < signals.sma50) bearScore += 1;

  // Volume (high vol on up move = bullish confirmation)
  if (signals.volumeRatio > 1.3) {
    const price_vs_open_guess = signals.macd.histogram > 0 ? 1 : -1;
    if (price_vs_open_guess > 0) bullScore += 1;
    else bearScore += 1;
  }

  if (bullScore > bearScore + 2) return "bullish";
  if (bearScore > bullScore + 2) return "bearish";
  return "neutral";
}

// ─── ETF setup restriction ────────────────────────────────────────────────────

const BULL_SETUPS: LegacySetup[] = ["Long Call", "Call Spread", "Bull Put Spread"];
const BEAR_SETUPS: LegacySetup[] = ["Long Put", "Bear Put Spread", "Bear Call Spread"];

function restrictETFSetup(
  setup: LegacySetup,
  etfCat: ScanOpts["etfCategory"],
  outlook: ScanOutlook,
  ivRank: number,
): LegacySetup {
  // Covered Calls require owning the underlying — not applicable to ETF options
  if (setup === "Covered Call") {
    return ivRank >= 60 ? "Bull Put Spread" : "Call Spread";
  }

  // Pure leveraged ETFs: lock to their directional setup list
  if (etfCat === "leveraged-bull" && !BULL_SETUPS.includes(setup)) {
    return ivRank >= 60 ? "Bull Put Spread" : ivRank < 30 ? "Long Call" : "Call Spread";
  }
  if (etfCat === "leveraged-bear" && !BEAR_SETUPS.includes(setup)) {
    return ivRank >= 60 ? "Bear Call Spread" : ivRank < 30 ? "Long Put" : "Bear Put Spread";
  }

  // Single-stock leveraged ETFs: restrict based on the computed outlook
  if (etfCat === "leveraged-single") {
    if (outlook === "bullish" && !BULL_SETUPS.includes(setup)) {
      return ivRank >= 60 ? "Bull Put Spread" : ivRank < 30 ? "Long Call" : "Call Spread";
    }
    if (outlook === "bearish" && !BEAR_SETUPS.includes(setup)) {
      return ivRank >= 60 ? "Bear Call Spread" : ivRank < 30 ? "Long Put" : "Bear Put Spread";
    }
  }

  return setup;
}

// ─── Setup selection ───────────────────────────────────────────────────────

function chooseSetup(outlook: ScanOutlook, ivRank: number, signals: TechnicalSignals): LegacySetup {
  if (outlook === "bullish") {
    if (ivRank >= 60) return "Bull Put Spread";
    if (ivRank >= 40 && signals.strength >= 6) return "Covered Call";
    if (ivRank < 30 && signals.strength >= 7) return "Long Call";
    return "Call Spread";
  }

  if (outlook === "bearish") {
    if (ivRank >= 60) return "Bear Call Spread";
    if (ivRank < 30 && signals.strength <= 4) return "Long Put";
    return "Bear Put Spread";
  }

  // Neutral
  if (ivRank >= 65) return "Iron Condor";
  if (ivRank <= 25) return "Straddle";
  if (ivRank >= 45) return "Iron Condor";
  return "Calendar";
}

// ─── Scoring components ─────────────────────────────────────────────────────

function scoreTechnical(signals: TechnicalSignals, outlook: ScanOutlook): number {
  // Max 35 pts
  // Requires broad agreement across trend, RSI, MACD, and MA stack.
  // Partial alignment scores much lower to avoid stacking mediocre signals.
  let score = 0;

  if (outlook === "bullish") {
    // MA stack (0–10): require sma20 > sma50 > sma200 for full points
    if (signals.sma20 > signals.sma50 && signals.sma50 > signals.sma200) score += 10;
    else if (signals.sma20 > signals.sma50) score += 4;   // partial alignment only

    // Trend + RSI combo (0–13): trend must be confirmed by RSI being in bullish zone
    if (signals.trend === "bullish" && signals.rsi14 >= 52 && signals.rsi14 <= 70) score += 13;
    else if (signals.trend === "bullish" && signals.rsi14 >= 45) score += 8;
    else if (signals.trend === "bullish") score += 4;           // trend without RSI confirmation
    else if (signals.rsi14 >= 55 && signals.rsi14 <= 70) score += 3; // RSI without trend

    // MACD (0–8): both value and histogram must agree for full score
    if (signals.macd.histogram > 0 && signals.macd.value > signals.macd.signal) score += 8;
    else if (signals.macd.histogram > 0) score += 3;           // weak — histogram alone

    // Strength bonus (0–4)
    if (signals.strength >= 8) score += 4;
    else if (signals.strength >= 6) score += 2;
  } else if (outlook === "bearish") {
    // Mirror: full MA stack bearish
    if (signals.sma20 < signals.sma50 && signals.sma50 < signals.sma200) score += 10;
    else if (signals.sma20 < signals.sma50) score += 4;

    if (signals.trend === "bearish" && signals.rsi14 <= 48 && signals.rsi14 >= 30) score += 13;
    else if (signals.trend === "bearish" && signals.rsi14 <= 55) score += 8;
    else if (signals.trend === "bearish") score += 4;
    else if (signals.rsi14 <= 45 && signals.rsi14 >= 30) score += 3;

    if (signals.macd.histogram < 0 && signals.macd.value < signals.macd.signal) score += 8;
    else if (signals.macd.histogram < 0) score += 3;

    if (signals.strength <= 3) score += 4;
    else if (signals.strength <= 5) score += 2;
  } else {
    // Neutral: RSI near 50 + flat MACD + neutral trend — all three required for high score
    const rsiNeutral  = signals.rsi14 >= 43 && signals.rsi14 <= 57;
    const macdFlat    = Math.abs(signals.macd.histogram) < Math.abs(signals.macd.signal) * 0.25;
    const trendFlat   = signals.trend === "neutral";

    if (rsiNeutral)  score += 10;
    else if (signals.rsi14 >= 38 && signals.rsi14 <= 62) score += 5;

    if (macdFlat)    score += 10;
    else if (Math.abs(signals.macd.histogram) < Math.abs(signals.macd.signal) * 0.5) score += 5;

    if (trendFlat)   score += 10;
    else             score += 3;

    // Confluence bonus: all three aligned is a genuine neutral environment
    if (rsiNeutral && macdFlat && trendFlat) score += 5;
  }

  return Math.min(35, score);
}

function scoreIvAlignment(ivRank: number, setup: LegacySetup, daysToEarnings?: number): number {
  // Max 25 pts — does the IV rank environment suit the strategy?
  const creditSelling = ["Bull Put Spread", "Bear Call Spread", "Iron Condor", "Covered Call"].includes(setup);
  const debitBuying   = ["Call Spread", "Long Call", "Bear Put Spread", "Long Put", "Straddle"].includes(setup);
  const timeSpread    = setup === "Calendar";

  let base: number;
  if (creditSelling) {
    if (ivRank >= 70) base = 25;
    else if (ivRank >= 55) base = 20;
    else if (ivRank >= 45) base = 14;
    else if (ivRank >= 35) base = 8;
    else base = 3;
  } else if (debitBuying) {
    if (ivRank <= 20) base = 25;
    else if (ivRank <= 35) base = 20;
    else if (ivRank <= 50) base = 13;
    else if (ivRank <= 65) base = 7;
    else base = 3;
  } else if (timeSpread) {
    if (ivRank >= 30 && ivRank <= 55) base = 22;
    else if (ivRank >= 20 && ivRank <= 65) base = 16;
    else base = 9;
  } else {
    base = 12;
  }

  // Earnings proximity bonus: near-term earnings inflate IV, which favours credit strategies.
  // Penalises debit buyers entering just before earnings crush.
  if (daysToEarnings !== undefined && daysToEarnings >= 0) {
    if (daysToEarnings <= 7) {
      // Very close — IV expansion almost certain
      base = creditSelling ? Math.min(25, base + 5) : Math.max(1, base - 4);
    } else if (daysToEarnings <= 21) {
      base = creditSelling ? Math.min(25, base + 3) : Math.max(1, base - 2);
    }
    // If earnings > 21 days away, no adjustment (normal vol environment)
  }

  return base;
}

function scoreEntryQuality(signals: TechnicalSignals, price: number, outlook: ScanOutlook): number {
  // Max 25 pts — must be near a meaningful S/R level to score well.
  // Mid-range positions score low — no edge, no setup.
  const range = signals.resistance - signals.support;
  if (range <= 0) return 6;

  const pos = (price - signals.support) / range; // 0 = at support, 1 = at resistance

  if (outlook === "bullish") {
    // Excellent: bouncing off support (within 15% of the range from support)
    if (pos >= 0.03 && pos <= 0.20) return 25;
    // Good: recently cleared support, still in lower third
    if (pos > 0.20 && pos <= 0.35) return 17;
    // Mediocre: mid-range — no clear S/R edge
    if (pos > 0.35 && pos <= 0.55) return 8;
    // Poor: extended toward resistance — chasing
    if (pos > 0.55 && pos <= 0.75) return 4;
    // Very poor: at or beyond resistance
    return 2;
  }

  if (outlook === "bearish") {
    // Excellent: rejecting from resistance (within 15% of range from top)
    if (pos >= 0.80 && pos <= 0.97) return 25;
    // Good: recently failed at resistance, still in upper third
    if (pos >= 0.65 && pos < 0.80) return 17;
    // Mediocre: mid-range — no clear S/R edge
    if (pos >= 0.45 && pos < 0.65) return 8;
    // Poor: extended toward support
    if (pos >= 0.25 && pos < 0.45) return 4;
    return 2;
  }

  // Neutral: must be in the middle third for range strategies to make sense
  if (pos >= 0.38 && pos <= 0.62) return 25;
  if (pos >= 0.25 && pos <= 0.75) return 14;
  return 5;
}

function scoreMomentum(signals: TechnicalSignals, changePercent: number, outlook: ScanOutlook, price: number): number {
  // Max 15 pts — volume MUST confirm the trade direction to score well.
  // Flat/opposing volume is a red flag, not neutral.
  let score = 0;

  // Volume confirmation (0–8): directional volume is required, not just present
  if (outlook === "bullish") {
    if      (signals.volumeRatio >= 1.5 && changePercent > 0.5) score += 8;  // strong up volume
    else if (signals.volumeRatio >= 1.2 && changePercent > 0)   score += 5;  // moderate up volume
    else if (signals.volumeRatio >= 1.0 && changePercent > 0)   score += 2;  // mild up volume
    // flat or down-volume day: 0 — not confirming the setup
  } else if (outlook === "bearish") {
    if      (signals.volumeRatio >= 1.5 && changePercent < -0.5) score += 8;
    else if (signals.volumeRatio >= 1.2 && changePercent < 0)    score += 5;
    else if (signals.volumeRatio >= 1.0 && changePercent < 0)    score += 2;
  } else {
    // Neutral: quiet volume is ideal — no big directional moves
    if      (signals.volumeRatio < 0.7)  score += 8;
    else if (signals.volumeRatio < 0.9)  score += 5;
    else if (signals.volumeRatio < 1.15) score += 2;
    // High volume in "neutral" environment: 0 — suggests breakout risk
  }

  // Strength alignment (0–4): must match direction for full credit
  if (outlook === "bullish" && signals.strength >= 7) score += 4;
  else if (outlook === "bullish" && signals.strength >= 5) score += 2;
  else if (outlook === "bearish" && signals.strength <= 4) score += 4;
  else if (outlook === "bearish" && signals.strength <= 6) score += 2;
  else if (outlook === "neutral") score += Math.round((1 - Math.abs(signals.strength - 5) / 5) * 4);

  // ATR environment check (0–3): volatility must suit the strategy type
  const atrPct = (signals.atr14 / price) * 100;
  if (outlook === "neutral" && atrPct < 2.0) score += 3;       // low ATR = range-bound
  else if (outlook !== "neutral" && atrPct >= 1.5 && atrPct <= 5) score += 3;
  else if (outlook !== "neutral" && atrPct >= 1.0) score += 1;
  // ATR > 5%: too chaotic for most options strategies, 0

  return Math.min(15, score);
}

// ─── VWAP position scoring ────────────────────────────────────────────────────

function scoreVwap(price: number, dayVwap: number, prevDayVwap: number, outlook: ScanOutlook): number {
  // Max 10 pts — VWAP must confirm the trade direction to score
  // A bullish stock below VWAP (failed intraday) gets 0. A bearish stock
  // above VWAP (failed breakdown) gets 0. Neutral gets no VWAP credit.
  if (outlook === "bullish") {
    let score = 0;
    if (dayVwap > 0 && price > dayVwap)          score += 5; // intraday above VWAP
    if (prevDayVwap > 0 && price > prevDayVwap)  score += 5; // above yesterday's VWAP
    return score;
  }
  if (outlook === "bearish") {
    let score = 0;
    if (dayVwap > 0 && price < dayVwap)          score += 5; // intraday below VWAP
    if (prevDayVwap > 0 && price < prevDayVwap)  score += 5; // below yesterday's VWAP
    return score;
  }
  return 0; // neutral strategies don't benefit from VWAP directionality
}

// ─── Human-readable setup description ────────────────────────────────────────

function buildDescription(
  setup: LegacySetup,
  outlook: ScanOutlook,
  ivRank: number,
  signals: TechnicalSignals,
  daysToEarnings?: number
): string {
  const ivLevel = ivRank >= 60 ? "high" : ivRank >= 35 ? "moderate" : "low";
  const trendStr = signals.trend === "bullish" ? "uptrend" : signals.trend === "bearish" ? "downtrend" : "sideways";

  const map: Record<LegacySetup, string> = {
    "Bull Put Spread":  `IV rank ${ivRank}% (${ivLevel}) — sell put credit below the ${trendStr}. Profit if price holds above short strike.`,
    "Call Spread":      `Defined-risk bullish play with IV at ${ivRank}%. Buy lower strike, sell upper strike to cap cost.`,
    "Long Call":        `Low IV (${ivRank}%) makes options cheap. Strong ${trendStr} justifies buying premium outright.`,
    "Covered Call":     `IV rank ${ivRank}% — sell call against long shares to collect income in the ${trendStr}.`,
    "Bear Call Spread": `IV rank ${ivRank}% (${ivLevel}) — sell call credit above the ${trendStr}. Profit if price stays below short strike.`,
    "Bear Put Spread":  `Defined-risk bearish play. Buy put, sell lower strike to reduce debit. IV at ${ivRank}%.`,
    "Long Put":         `Low IV (${ivRank}%) makes puts cheap. Strong ${trendStr} confirms bearish directional play.`,
    "Iron Condor":      `IV rank ${ivRank}% — very elevated vol makes selling both wings attractive. Profit in a range.`,
    "Straddle":         `IV rank ${ivRank}% is very low — options are cheap. Buy a straddle ahead of expected vol expansion.`,
    "Calendar":         `Sell near-term, buy longer-dated same strike. IV at ${ivRank}% supports time decay differential.`,
    "Neutral":          `No high-conviction setup. Watch for trend development or IV expansion before entering.`,
  };

  let desc = map[setup] ?? "Options opportunity identified based on technical and volatility analysis.";

  // Append earnings risk / opportunity note when relevant
  if (daysToEarnings !== undefined && daysToEarnings >= 0 && daysToEarnings <= 21) {
    const creditSelling = (["Bull Put Spread", "Bear Call Spread", "Iron Condor", "Covered Call"] as LegacySetup[]).includes(setup);
    if (daysToEarnings <= 7) {
      desc += creditSelling
        ? ` ⚠ Earnings in ≤${daysToEarnings}d — IV elevated; manage risk before the event.`
        : ` ⚠ Earnings in ≤${daysToEarnings}d — consider waiting for post-earnings vol crush before entering.`;
    } else {
      desc += ` Earnings in ~${daysToEarnings}d — IV may continue expanding toward the event.`;
    }
  }

  return desc;
}
