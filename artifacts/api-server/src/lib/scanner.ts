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
  opportunityScore: number;     // 0–100
  setupType: SetupType;
  recommendedOutlook: ScanOutlook;
  setupDescription: string;
  technicalScore: number;       // 0–35 (debugging)
  ivScore: number;              // 0–25
  entryScore: number;           // 0–25
  momentumScore: number;        // 0–15
}

export function scanOpportunity(
  signals: TechnicalSignals,
  ivRank: number,
  price: number,
  changePercent: number,
  daysToEarnings?: number   // undefined = unknown, 0 = today/past
): ScanResult {
  // ── 1. Determine directional outlook ────────────────────────────────────
  const outlook = determineOutlook(signals, ivRank);

  // ── 2. Choose the best setup for this outlook + IV environment ───────────
  const setup = chooseSetup(outlook, ivRank, signals);

  // ── 3. Score each dimension ──────────────────────────────────────────────
  const technicalScore = scoreTechnical(signals, outlook);
  const ivScore        = scoreIvAlignment(ivRank, setup, daysToEarnings);
  const entryScore     = scoreEntryQuality(signals, price, outlook);
  const momentumScore  = scoreMomentum(signals, changePercent, outlook, price);

  const total = Math.round(technicalScore + ivScore + entryScore + momentumScore);
  const opportunityScore = Math.max(0, Math.min(100, total));

  return {
    opportunityScore,
    setupType: setup,
    recommendedOutlook: outlook,
    setupDescription: buildDescription(setup, outlook, ivRank, signals, daysToEarnings),
    technicalScore: Math.round(technicalScore),
    ivScore: Math.round(ivScore),
    entryScore: Math.round(entryScore),
    momentumScore: Math.round(momentumScore),
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

  if (bullScore > bearScore + 1) return "bullish";
  if (bearScore > bullScore + 1) return "bearish";
  return "neutral";
}

// ─── Setup selection ───────────────────────────────────────────────────────

function chooseSetup(outlook: ScanOutlook, ivRank: number, signals: TechnicalSignals): SetupType {
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
  let score = 0;

  if (outlook === "bullish") {
    // Trend alignment (0–12)
    if (signals.trend === "bullish") score += 12;
    else if (signals.trend === "neutral") score += 4;

    // RSI zone — want 45–70 for bullish (0–8)
    if (signals.rsi14 >= 52 && signals.rsi14 <= 68) score += 8;
    else if (signals.rsi14 >= 45 && signals.rsi14 < 52) score += 5;
    else if (signals.rsi14 > 68 && signals.rsi14 < 75) score += 4;  // overbought but still bullish
    else if (signals.rsi14 >= 35 && signals.rsi14 < 45) score += 2; // weak but not bear

    // MACD (0–8)
    if (signals.macd.histogram > 0 && signals.macd.value > signals.macd.signal) score += 8;
    else if (signals.macd.histogram > 0) score += 4;

    // MA alignment: above 20 and 50 (0–7)
    if (signals.sma20 > signals.sma50) score += 4;
    if (signals.strength >= 7) score += 3;
  } else if (outlook === "bearish") {
    // Mirror logic
    if (signals.trend === "bearish") score += 12;
    else if (signals.trend === "neutral") score += 4;

    if (signals.rsi14 <= 48 && signals.rsi14 >= 32) score += 8;
    else if (signals.rsi14 > 48 && signals.rsi14 <= 55) score += 5;
    else if (signals.rsi14 < 32 && signals.rsi14 > 25) score += 4;

    if (signals.macd.histogram < 0 && signals.macd.value < signals.macd.signal) score += 8;
    else if (signals.macd.histogram < 0) score += 4;

    if (signals.sma20 < signals.sma50) score += 4;
    if (signals.strength <= 4) score += 3;
  } else {
    // Neutral: want RSI near 50, MACD near zero, low ATR relative to price
    if (signals.rsi14 >= 42 && signals.rsi14 <= 58) score += 10;
    else if (signals.rsi14 >= 38 && signals.rsi14 <= 62) score += 5;

    const macdNeutral = Math.abs(signals.macd.histogram) < Math.abs(signals.macd.signal) * 0.3;
    if (macdNeutral) score += 8;

    if (signals.trend === "neutral") score += 12;
    else score += 4;

    score += 5; // base for neutral
  }

  return Math.min(35, score);
}

function scoreIvAlignment(ivRank: number, setup: SetupType, daysToEarnings?: number): number {
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
  // Max 25 pts — proximity and alignment with S/R levels
  const range = signals.resistance - signals.support;
  if (range <= 0) return 10;

  const pos = (price - signals.support) / range; // 0 = at support, 1 = at resistance

  if (outlook === "bullish") {
    // Best entry: price near support (0.0–0.35), having bounced
    if (pos >= 0.05 && pos <= 0.30) return 25;      // sweet spot — near support
    if (pos >= 0.30 && pos <= 0.50) return 18;      // mid-range, still good
    if (pos > 0.50 && pos <= 0.70) return 10;       // above mid, caution
    if (pos > 0.70) return 4;                        // near resistance, poor entry
    return 12;                                        // very close to support
  }

  if (outlook === "bearish") {
    // Best entry: price near resistance (0.65–0.95), having rejected
    if (pos >= 0.70 && pos <= 0.95) return 25;      // sweet spot — near resistance
    if (pos >= 0.50 && pos < 0.70) return 18;
    if (pos < 0.50 && pos >= 0.30) return 10;
    if (pos < 0.30) return 4;                        // near support, poor short entry
    return 12;
  }

  // Neutral: best when price is in the middle (good for range strategies)
  if (pos >= 0.35 && pos <= 0.65) return 25;
  if (pos >= 0.20 && pos <= 0.80) return 16;
  return 8;
}

function scoreMomentum(signals: TechnicalSignals, changePercent: number, outlook: ScanOutlook, price: number): number {
  // Max 15 pts — volume, ATR, recent price velocity
  let score = 0;

  // Volume confirmation (0–7): high vol in the direction of the trade
  if (outlook === "bullish") {
    if (signals.volumeRatio >= 1.5 && changePercent > 0) score += 7;
    else if (signals.volumeRatio >= 1.2 && changePercent > 0) score += 5;
    else if (signals.volumeRatio >= 1.0) score += 3;
    else score += 1;
  } else if (outlook === "bearish") {
    if (signals.volumeRatio >= 1.5 && changePercent < 0) score += 7;
    else if (signals.volumeRatio >= 1.2 && changePercent < 0) score += 5;
    else if (signals.volumeRatio >= 1.0) score += 3;
    else score += 1;
  } else {
    // Neutral: want low volume (quiet market = good for credit strategies)
    if (signals.volumeRatio < 0.8) score += 7;
    else if (signals.volumeRatio < 1.2) score += 4;
    else score += 1;
  }

  // Trend strength score (0–5)
  score += Math.round((signals.strength / 10) * 5);

  // ATR relative check: is volatility appropriate? (0–3)
  // ATR < 3% of price = stable, good for credit; > 3% = high vol environment
  const atrPct = (signals.atr14 / price) * 100;
  if (outlook === "neutral" && atrPct < 2.5) score += 3;
  else if (outlook !== "neutral" && atrPct >= 1.5 && atrPct <= 4) score += 3;
  else score += 1;

  return Math.min(15, score);
}

// ─── Human-readable setup description ────────────────────────────────────────

function buildDescription(
  setup: SetupType,
  outlook: ScanOutlook,
  ivRank: number,
  signals: TechnicalSignals,
  daysToEarnings?: number
): string {
  const ivLevel = ivRank >= 60 ? "high" : ivRank >= 35 ? "moderate" : "low";
  const trendStr = signals.trend === "bullish" ? "uptrend" : signals.trend === "bearish" ? "downtrend" : "sideways";

  const map: Record<SetupType, string> = {
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
    const creditSelling = ["Bull Put Spread", "Bear Call Spread", "Iron Condor", "Covered Call"].includes(setup);
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
