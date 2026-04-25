/**
 * Options Opportunity Scanner
 *
 * Evaluates each stock on five factors and produces an actionable scan result:
 *
 * 1. Technical Setup   (0–10) — MA stack, trend+RSI combo, MACD alignment
 * 2. IV Regime         (0–10) — IV rank suitability for the chosen strategy (sell high, buy low)
 * 3. Momentum          (0–10) — Volume confirmation + VWAP position + ATR environment
 * 4. Entry Quality     (0–10) — Price position within the S/R range; penalises chasing
 * 5. Earnings Risk     (0–10) — Days-to-earnings proximity relative to strategy type
 *
 * Composite (0–100): weighted average × 10.
 * Default weights: Technical 25, IV 25, Momentum 20, Entry 15, Risk 15.
 *
 * Hard gates (transparent):
 *   Any factor < 2.0  → score capped at 40, setup → Neutral  (critical weakness)
 *   2+ factors < 4.0  → score capped at 62                   (marginal setup)
 * Which factors triggered is returned in `weakFactors`.
 *
 * Setup types map to an OptionsPlay-style strategy matrix:
 *   Bullish + IV low/med  → Call Spread | Long Call
 *   Bullish + IV high     → Bull Put Spread (credit)
 *   Bearish + IV low/med  → Bear Put Spread | Long Put
 *   Bearish + IV high     → Bear Call Spread (credit)
 *   Neutral + IV very high → Iron Condor
 *   Neutral + IV very low  → Straddle
 *   Bullish + IV high + trending → Covered Call
 */

import type { TechnicalSignals } from "./technical-analysis.js";

export type SetupType =
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

export type ScanOutlook = "bullish" | "bearish" | "neutral";

export interface ScanResult {
  opportunityScore: number;     // 0–100 composite
  setupType: SetupType;
  recommendedOutlook: ScanOutlook;
  setupDescription: string;
  technicalScore: number;   // 0–10
  ivScore: number;          // 0–10
  momentumScore: number;    // 0–10 (includes VWAP)
  entryScore: number;       // 0–10
  riskScore: number;        // 0–10 (earnings proximity)
  weakFactors: string[];    // factor names scoring < 4.0
  scoreCapped: boolean;     // true when a hard gate reduced the composite
}

export interface HighConvictionThresholds {
  opportunityScore: number;
  technicalScore: number;   // 0–10 scale
  ivScore: number;          // 0–10 scale
  entryScore: number;       // 0–10 scale
  momentumScore: number;    // 0–10 scale
  riskScore: number;        // 0–10 scale
}

export interface HighConvictionCandidate {
  opportunityScore: number;
  technicalScore: number;
  ivScore: number;
  entryScore: number;
  momentumScore: number;
  riskScore: number;
}

export const DEFAULT_HIGH_CONVICTION_THRESHOLDS: HighConvictionThresholds = {
  opportunityScore: 72,
  technicalScore: 6,
  ivScore: 6,
  entryScore: 5,
  momentumScore: 5,
  riskScore: 5,
};

export interface StrategyScoreWeights {
  technical: number;
  iv: number;
  entry: number;
  momentum: number;
  risk: number;
}

export interface StrategyPreferences {
  preferredIvEnvironment: "high" | "low" | "any";
  ivRankLowThreshold: number;
  ivRankHighThreshold: number;
  strategyAutoSelectByIv: boolean;
  scoreWeights: StrategyScoreWeights;
}

export const DEFAULT_STRATEGY_PREFERENCES: StrategyPreferences = {
  ivRankLowThreshold: 30,
  ivRankHighThreshold: 60,
  preferredIvEnvironment: "any",
  strategyAutoSelectByIv: true,
  scoreWeights: {
    technical: 25,
    iv: 25,
    momentum: 20,
    entry: 15,
    risk: 15,
  },
};

export interface RiskPreferences {
  riskMinDTE: number;
  riskMaxDTE: number;
  earningsAvoidanceDays: number;
  earningsAvoidanceBeforeDays: number;
  earningsAvoidanceAfterDays: number;
  minOpenInterest: number;
  minContractVolume: number;
  maxBidAskSpreadPct: number;
}

export const DEFAULT_RISK_PREFERENCES: RiskPreferences = {
  riskMinDTE: 21,
  riskMaxDTE: 60,
  earningsAvoidanceDays: 5,
  earningsAvoidanceBeforeDays: 5,
  earningsAvoidanceAfterDays: 1,
  minOpenInterest: 100,
  minContractVolume: 10,
  maxBidAskSpreadPct: 10,
};

export function isHighConviction(
  row: HighConvictionCandidate,
  thresholds: HighConvictionThresholds = DEFAULT_HIGH_CONVICTION_THRESHOLDS,
): boolean {
  return row.opportunityScore >= thresholds.opportunityScore
    && row.technicalScore    >= thresholds.technicalScore
    && row.ivScore           >= thresholds.ivScore
    && row.entryScore        >= thresholds.entryScore
    && row.momentumScore     >= thresholds.momentumScore
    && row.riskScore         >= thresholds.riskScore;
}

export interface ScanOpts {
  isETF?: boolean;
  etfCategory?: "leveraged-bull" | "leveraged-bear" | "leveraged-single" | "sector";
  strategyPreferences?: StrategyPreferences;
  riskPreferences?: RiskPreferences;
}

export function scanOpportunity(
  signals: TechnicalSignals,
  ivRank: number,
  price: number,
  changePercent: number,
  daysToEarnings?: number,   // undefined = unknown; negative = post-earnings
  dayVwap = 0,               // today's VWAP from Polygon snapshot (0 = unavailable)
  prevDayVwap = 0,           // previous day's VWAP
  opts?: ScanOpts,
): ScanResult {
  const isETF  = opts?.isETF ?? false;
  const etfCat = opts?.etfCategory;
  const prefs: StrategyPreferences = {
    ...DEFAULT_STRATEGY_PREFERENCES,
    ...(opts?.strategyPreferences ?? {}),
    scoreWeights: {
      ...DEFAULT_STRATEGY_PREFERENCES.scoreWeights,
      ...(opts?.strategyPreferences?.scoreWeights ?? {}),
    },
  };

  // ── 1. Directional outlook ────────────────────────────────────────────────
  let outlook = determineOutlook(signals, ivRank);
  if (etfCat === "leveraged-bull") outlook = "bullish";
  if (etfCat === "leveraged-bear") outlook = "bearish";

  // ── 2. Setup selection ────────────────────────────────────────────────────
  let setup: SetupType = chooseSetup(outlook, ivRank, signals, prefs);
  if (isETF) setup = restrictETFSetup(setup, etfCat, outlook, ivRank, prefs);

  // ── 3. Grade each dimension (0–10 each) ───────────────────────────────────
  let technicalScore = gradeTechnical(signals, outlook);
  let ivScore        = gradeIvRegime(ivRank, setup);
  let momentumScore  = gradeMomentum(signals, changePercent, outlook, price, dayVwap, prevDayVwap);
  let entryScore     = gradeEntry(signals, price, outlook);
  const riskScore    = gradeEarningsRisk(setup, daysToEarnings, isETF);

  // ETF adjustments: cleaner trend signals but IV rank less meaningful
  if (isETF) {
    technicalScore = Math.min(10, technicalScore + 0.5);
    momentumScore  = Math.min(10, momentumScore  + 0.5);
    ivScore        = Math.max(0,  ivScore        - 0.5);
  }

  // ── 4. Weighted composite (0–100) ─────────────────────────────────────────
  const w = prefs.scoreWeights;
  const totalWeight = w.technical + w.iv + w.momentum + w.entry + w.risk;
  const safe = totalWeight > 0 ? totalWeight : 100;

  const raw = (
    technicalScore * w.technical +
    ivScore        * w.iv +
    momentumScore  * w.momentum +
    entryScore     * w.entry +
    riskScore      * w.risk
  ) / safe * 10;  // 0–100

  // ── 5. Track weak factors for transparency ────────────────────────────────
  const factorMap = [
    { name: "Technical", score: technicalScore },
    { name: "IV",        score: ivScore },
    { name: "Momentum",  score: momentumScore },
    { name: "Entry",     score: entryScore },
    { name: "Risk",      score: riskScore },
  ];
  const weakFactors  = factorMap.filter(f => f.score < 4.0).map(f => f.name);
  const criticalCount = factorMap.filter(f => f.score < 2.0).length;

  // ── 6. Hard gates (transparent) ──────────────────────────────────────────
  let cappedScore   = raw;
  let cappedSetup   = setup;
  let cappedOutlook = outlook;
  let scoreCapped   = false;

  if (criticalCount >= 1) {
    cappedScore   = Math.min(cappedScore, 40);
    cappedSetup   = "Neutral";
    cappedOutlook = "neutral";
    scoreCapped   = true;
  } else if (weakFactors.length >= 2) {
    if (cappedScore > 62) {
      cappedScore = 62;
      scoreCapped = true;
    }
  }

  const opportunityScore = Math.max(0, Math.min(100, Math.round(cappedScore)));

  return {
    opportunityScore,
    setupType: cappedSetup,
    recommendedOutlook: cappedOutlook,
    setupDescription: buildDescription(cappedSetup, cappedOutlook, ivRank, signals, isETF ? undefined : daysToEarnings),
    technicalScore: round1(technicalScore),
    ivScore:        round1(ivScore),
    momentumScore:  round1(momentumScore),
    entryScore:     round1(entryScore),
    riskScore:      round1(riskScore),
    weakFactors,
    scoreCapped,
  };
}

// ─── Outlook determination ────────────────────────────────────────────────────

function determineOutlook(signals: TechnicalSignals, _ivRank: number): ScanOutlook {
  let bull = 0;
  let bear = 0;

  if (signals.trend === "bullish") bull += 3;
  if (signals.trend === "bearish") bear += 3;

  if (signals.rsi14 > 55 && signals.rsi14 < 75) bull += 2;
  if (signals.rsi14 < 45 && signals.rsi14 > 25) bear += 2;
  if (signals.rsi14 >= 75) bull += 0.5;
  if (signals.rsi14 <= 25) bear += 0.5;

  if (signals.macd.histogram > 0) bull += 2;
  if (signals.macd.histogram < 0) bear += 2;

  if (signals.sma20 > signals.sma50) bull += 1;
  if (signals.sma20 < signals.sma50) bear += 1;

  if (signals.volumeRatio > 1.3) {
    if (signals.macd.histogram > 0) bull += 1; else bear += 1;
  }

  if (bull > bear + 2) return "bullish";
  if (bear > bull + 2) return "bearish";
  return "neutral";
}

// ─── ETF setup restriction ────────────────────────────────────────────────────

const BULL_SETUPS: SetupType[] = ["Long Call", "Call Spread", "Bull Put Spread"];
const BEAR_SETUPS: SetupType[] = ["Long Put", "Bear Put Spread", "Bear Call Spread"];

function restrictETFSetup(
  setup: SetupType,
  etfCat: ScanOpts["etfCategory"],
  outlook: ScanOutlook,
  ivRank: number,
  prefs: StrategyPreferences,
): SetupType {
  const highIv = prefs.ivRankHighThreshold;
  const lowIv  = prefs.ivRankLowThreshold;

  if (setup === "Covered Call") {
    return ivRank >= highIv ? "Bull Put Spread" : "Call Spread";
  }
  if (etfCat === "leveraged-bull" && !BULL_SETUPS.includes(setup)) {
    return ivRank >= highIv ? "Bull Put Spread" : ivRank < lowIv ? "Long Call" : "Call Spread";
  }
  if (etfCat === "leveraged-bear" && !BEAR_SETUPS.includes(setup)) {
    return ivRank >= highIv ? "Bear Call Spread" : ivRank < lowIv ? "Long Put" : "Bear Put Spread";
  }
  if (etfCat === "leveraged-single") {
    if (outlook === "bullish" && !BULL_SETUPS.includes(setup))
      return ivRank >= highIv ? "Bull Put Spread" : ivRank < lowIv ? "Long Call" : "Call Spread";
    if (outlook === "bearish" && !BEAR_SETUPS.includes(setup))
      return ivRank >= highIv ? "Bear Call Spread" : ivRank < lowIv ? "Long Put" : "Bear Put Spread";
  }
  return setup;
}

// ─── Setup selection ──────────────────────────────────────────────────────────

function chooseSetup(
  outlook: ScanOutlook,
  ivRank: number,
  signals: TechnicalSignals,
  prefs: StrategyPreferences,
): SetupType {
  const highIv = prefs.ivRankHighThreshold;
  const lowIv  = prefs.ivRankLowThreshold;
  const useIv  = prefs.strategyAutoSelectByIv;

  if (outlook === "bullish") {
    if (useIv && ivRank >= highIv) return "Bull Put Spread";
    if (useIv && ivRank >= Math.max(lowIv, highIv - 20) && signals.strength >= 6) return "Covered Call";
    if (useIv && ivRank < lowIv && signals.strength >= 7) return "Long Call";
    return "Call Spread";
  }
  if (outlook === "bearish") {
    if (useIv && ivRank >= highIv) return "Bear Call Spread";
    if (useIv && ivRank < lowIv && signals.strength <= 4) return "Long Put";
    return "Bear Put Spread";
  }
  // Neutral
  if (useIv && ivRank >= highIv + 5) return "Iron Condor";
  if (useIv && ivRank <= Math.max(0, lowIv - 5)) return "Straddle";
  if (useIv && ivRank >= Math.max(lowIv, highIv - 15)) return "Iron Condor";
  return "Calendar";
}

// ─── Factor graders ───────────────────────────────────────────────────────────

function gradeTechnical(signals: TechnicalSignals, outlook: ScanOutlook): number {
  // MA stack (0–3) + Trend+RSI combo (0–4) + MACD (0–3) = max 10
  let score = 0;

  if (outlook === "bullish") {
    if (signals.sma20 > signals.sma50 && signals.sma50 > signals.sma200) score += 3.0;
    else if (signals.sma20 > signals.sma50) score += 1.5;

    if      (signals.trend === "bullish" && signals.rsi14 >= 52 && signals.rsi14 <= 70) score += 4.0;
    else if (signals.trend === "bullish" && signals.rsi14 >= 45)                        score += 2.5;
    else if (signals.trend === "bullish")                                                score += 1.5;
    else if (signals.rsi14 >= 55 && signals.rsi14 <= 70)                               score += 0.5;

    if      (signals.macd.histogram > 0 && signals.macd.value > signals.macd.signal) score += 3.0;
    else if (signals.macd.histogram > 0)                                               score += 1.5;

  } else if (outlook === "bearish") {
    if (signals.sma20 < signals.sma50 && signals.sma50 < signals.sma200) score += 3.0;
    else if (signals.sma20 < signals.sma50) score += 1.5;

    if      (signals.trend === "bearish" && signals.rsi14 <= 48 && signals.rsi14 >= 30) score += 4.0;
    else if (signals.trend === "bearish" && signals.rsi14 <= 55)                        score += 2.5;
    else if (signals.trend === "bearish")                                                score += 1.5;
    else if (signals.rsi14 <= 45 && signals.rsi14 >= 30)                               score += 0.5;

    if      (signals.macd.histogram < 0 && signals.macd.value < signals.macd.signal) score += 3.0;
    else if (signals.macd.histogram < 0)                                               score += 1.5;

  } else {
    // Neutral: RSI near 50 (0–3) + flat MACD (0–4) + neutral trend (0–3)
    const rsiNeutral = signals.rsi14 >= 43 && signals.rsi14 <= 57;
    const macdFlat   = Math.abs(signals.macd.histogram) < Math.abs(signals.macd.signal) * 0.25;
    const trendFlat  = signals.trend === "neutral";

    if (rsiNeutral) score += 3.0;
    else if (signals.rsi14 >= 38 && signals.rsi14 <= 62) score += 1.5;

    if (macdFlat) score += 4.0;
    else if (Math.abs(signals.macd.histogram) < Math.abs(signals.macd.signal) * 0.5) score += 2.0;

    score += trendFlat ? 3.0 : 1.0;
  }

  return Math.min(10, score);
}

// Exported so strategy-engine can reuse the same IV grading logic
export function gradeIvRegime(ivRank: number, setup: SetupType): number {
  const creditSelling = (["Bull Put Spread", "Bear Call Spread", "Iron Condor", "Covered Call"] as SetupType[]).includes(setup);
  const debitBuying   = (["Call Spread", "Long Call", "Bear Put Spread", "Long Put", "Straddle"] as SetupType[]).includes(setup);
  const timeSpread    = setup === "Calendar";

  if (creditSelling) {
    if (ivRank >= 70) return 10.0;
    if (ivRank >= 60) return 8.5;
    if (ivRank >= 50) return 7.0;
    if (ivRank >= 40) return 5.5;
    if (ivRank >= 30) return 3.0;
    return 1.0;
  }

  if (debitBuying) {
    if (ivRank <= 20) return 10.0;
    if (ivRank <= 30) return 8.5;
    if (ivRank <= 40) return 7.0;
    if (ivRank <= 50) return 5.0;
    if (ivRank <= 65) return 2.5;
    return 1.0;
  }

  if (timeSpread) {
    if (ivRank >= 30 && ivRank <= 55) return 10.0;
    if (ivRank >= 20 && ivRank <= 65) return 7.0;
    return 3.0;
  }

  return 5.0;  // Neutral setup
}

function gradeMomentum(
  signals: TechnicalSignals,
  changePercent: number,
  outlook: ScanOutlook,
  price: number,
  dayVwap: number,
  prevDayVwap: number,
): number {
  // Volume (0–4) + VWAP (0–3) + ATR (0–2) + strength alignment (0–1) = max 10
  let score = 0;

  // Volume confirmation (0–4)
  if (outlook === "bullish") {
    if      (signals.volumeRatio >= 1.5 && changePercent >  0.5) score += 4.0;
    else if (signals.volumeRatio >= 1.2 && changePercent >  0)   score += 2.5;
    else if (signals.volumeRatio >= 1.0 && changePercent >  0)   score += 1.0;
  } else if (outlook === "bearish") {
    if      (signals.volumeRatio >= 1.5 && changePercent < -0.5) score += 4.0;
    else if (signals.volumeRatio >= 1.2 && changePercent <  0)   score += 2.5;
    else if (signals.volumeRatio >= 1.0 && changePercent <  0)   score += 1.0;
  } else {
    // Neutral: quiet volume is ideal
    if      (signals.volumeRatio < 0.7)  score += 4.0;
    else if (signals.volumeRatio < 0.9)  score += 2.5;
    else if (signals.volumeRatio < 1.15) score += 1.0;
  }

  // VWAP position (0–3): 1.5 per confirming VWAP level
  if (outlook === "bullish") {
    if (dayVwap     > 0 && price > dayVwap)     score += 1.5;
    if (prevDayVwap > 0 && price > prevDayVwap) score += 1.5;
  } else if (outlook === "bearish") {
    if (dayVwap     > 0 && price < dayVwap)     score += 1.5;
    if (prevDayVwap > 0 && price < prevDayVwap) score += 1.5;
  }
  // Neutral strategies don't benefit from directional VWAP

  // ATR environment (0–2): volatility must suit strategy type
  const atrPct = price > 0 ? (signals.atr14 / price) * 100 : 0;
  if (outlook === "neutral" && atrPct < 2.0)                       score += 2.0;
  else if (outlook !== "neutral" && atrPct >= 1.5 && atrPct <= 5) score += 2.0;
  else if (outlook !== "neutral" && atrPct >= 1.0)                 score += 1.0;

  // Strength alignment (0–1)
  if (outlook === "bullish") {
    score += signals.strength >= 7 ? 1.0 : signals.strength >= 5 ? 0.5 : 0;
  } else if (outlook === "bearish") {
    score += signals.strength <= 3 ? 1.0 : signals.strength <= 5 ? 0.5 : 0;
  } else {
    score += Math.max(0, 1 - Math.abs(signals.strength - 5) / 5);
  }

  return Math.min(10, score);
}

function gradeEntry(signals: TechnicalSignals, price: number, outlook: ScanOutlook): number {
  const range = signals.resistance - signals.support;
  if (range <= 0) return 5.0;  // insufficient S/R data — neutral

  const pos = (price - signals.support) / range;  // 0 = at support, 1 = at resistance

  if (outlook === "bullish") {
    if (pos >= 0.03 && pos <= 0.20) return 10.0;  // near support — ideal
    if (pos >  0.20 && pos <= 0.35) return 7.0;   // lower third — good
    if (pos >  0.35 && pos <= 0.55) return 3.5;   // mid-range — no edge
    if (pos >  0.55 && pos <= 0.75) return 1.5;   // extended, chasing
    return 0.5;                                    // at/beyond resistance
  }

  if (outlook === "bearish") {
    if (pos >= 0.80 && pos <= 0.97) return 10.0;  // near resistance — ideal
    if (pos >= 0.65 && pos <  0.80) return 7.0;
    if (pos >= 0.45 && pos <  0.65) return 3.5;
    if (pos >= 0.25 && pos <  0.45) return 1.5;
    return 0.5;
  }

  // Neutral: needs to be in the middle of the range
  if (pos >= 0.38 && pos <= 0.62) return 10.0;
  if (pos >= 0.25 && pos <= 0.75) return 5.5;
  return 2.0;
}

function gradeEarningsRisk(setup: SetupType, daysToEarnings: number | undefined, isETF: boolean): number {
  // 10 = safe, far from earnings; 1 = debit trade 2 days before earnings
  if (isETF)                       return 7.5;  // no earnings risk
  if (daysToEarnings === undefined) return 6.5;  // unknown — mild caution
  if (daysToEarnings < 0)          return 8.5;  // post-earnings: vol crush done

  const creditSelling = (["Bull Put Spread", "Bear Call Spread", "Iron Condor", "Covered Call"] as SetupType[]).includes(setup);

  if (daysToEarnings > 30) return 10.0;
  if (daysToEarnings > 21) return 8.5;
  if (daysToEarnings > 14) return 7.0;
  // 7–14 days: IV beginning to inflate toward the event
  if (daysToEarnings >  7) return creditSelling ? 6.0 : 3.0;
  // 3–7 days: binary event imminent
  if (daysToEarnings >= 3) return creditSelling ? 4.5 : 1.5;
  // 0–2 days: extreme risk on both sides
  return creditSelling ? 3.0 : 1.0;
}

// ─── Human-readable setup description ────────────────────────────────────────

function buildDescription(
  setup: SetupType,
  outlook: ScanOutlook,
  ivRank: number,
  signals: TechnicalSignals,
  daysToEarnings?: number,
): string {
  const ivLevel  = ivRank >= 60 ? "high" : ivRank >= 35 ? "moderate" : "low";
  const trendStr = signals.trend === "bullish" ? "uptrend" : signals.trend === "bearish" ? "downtrend" : "sideways";

  const map: Record<SetupType, string> = {
    "Bull Put Spread":  `IV rank ${ivRank}% (${ivLevel}) — sell put credit below the ${trendStr}. Profit if price holds above short strike.`,
    "Call Spread":      `Defined-risk bullish play with IV at ${ivRank}%. Buy lower strike, sell upper strike to cap cost.`,
    "Long Call":        `Low IV (${ivRank}%) makes options cheap. Strong ${trendStr} justifies buying premium outright.`,
    "Covered Call":     `IV rank ${ivRank}% — sell call against long shares to collect income in the ${trendStr}.`,
    "Bear Call Spread": `IV rank ${ivRank}% (${ivLevel}) — sell call credit above the ${trendStr}. Profit if price stays below short strike.`,
    "Bear Put Spread":  `Defined-risk bearish play. Buy put, sell lower strike to reduce debit. IV at ${ivRank}%.`,
    "Long Put":         `Low IV (${ivRank}%) makes puts cheap. Strong ${trendStr} confirms bearish directional play.`,
    "Iron Condor":      `IV rank ${ivRank}% — elevated vol makes selling both wings attractive. Profit if price stays in range.`,
    "Straddle":         `IV rank ${ivRank}% is very low — options are cheap. Buy straddle ahead of expected vol expansion.`,
    "Calendar":         `Sell near-term, buy longer-dated same strike. IV at ${ivRank}% supports time decay differential.`,
    "Neutral":          `No high-conviction setup. Watch for trend development or IV expansion before entering.`,
  };

  let desc = map[setup] ?? "Options opportunity identified based on technical and volatility analysis.";

  if (daysToEarnings !== undefined && daysToEarnings >= 0 && daysToEarnings <= 21) {
    const creditSelling = (["Bull Put Spread", "Bear Call Spread", "Iron Condor", "Covered Call"] as SetupType[]).includes(setup);
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

function round1(n: number): number { return Math.round(n * 10) / 10; }
