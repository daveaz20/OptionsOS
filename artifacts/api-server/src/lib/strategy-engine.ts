/**
 * Options Strategy Engine — OptionsPlay-inspired methodology
 *
 * Strategy selection rules (IV Rank × Outlook matrix):
 *
 *  Outlook  | IV Rank    | Strategy
 *  ─────────────────────────────────────────────────────────────
 *  Bullish  | High ≥50   | Bull Put Spread (sell credit), Covered Call
 *  Bullish  | Med 25-50  | Bull Call Spread (debit)
 *  Bullish  | Low <25    | Long Call, Bull Call Spread
 *  Bearish  | High ≥50   | Bear Call Spread (sell credit)
 *  Bearish  | Med 25-50  | Bear Put Spread (debit)
 *  Bearish  | Low <25    | Long Put, Bear Put Spread
 *  Neutral  | High ≥45   | Iron Condor, Short Strangle
 *  Neutral  | Low <45    | Long Straddle, Calendar Spread
 *
 * Score (0–200) methodology:
 *  - Risk/Reward ratio:      0–60 pts  (max_profit / max_loss)
 *  - Probability of profit:  0–60 pts  (based on delta of short strike)
 *  - IV alignment:           0–40 pts  (high IV → selling; low IV → buying)
 *  - Technical alignment:    0–40 pts  (trend confirms strategy direction)
 */

import type { TechnicalSignals } from "./technical-analysis.js";

export interface StrategyLeg {
  action: "buy" | "sell";
  optionType: "call" | "put" | "stock";
  strikePrice: number;
  premium: number;
  quantity: number;
  expiration: string;
}

export interface OptionsStrategy {
  id: number;
  name: string;
  type: "trade" | "income";
  outlook: "bullish" | "bearish" | "neutral";
  description: string;
  legs: StrategyLeg[];
  tradeCost: number;
  maxProfit: number;
  maxLoss: number;
  returnPercent: number;
  breakeven: number;
  score: number;
  expirationDate: string;
}

type Outlook = "bullish" | "bearish" | "neutral";

export function buildStrategies(
  symbol: string,
  currentPrice: number,
  ivRank: number,
  hv30: number,         // realized vol as decimal (e.g. 0.28)
  signals: TechnicalSignals,
  outlook: Outlook
): OptionsStrategy[] {
  // Use HV30 as our IV proxy (in %) — inflate slightly for option premiums
  const iv = Math.max(hv30 / 100, 0.15) * 1.15;

  // Standard expiration: ~45 DTE (OptionsPlay sweet spot)
  const exp45 = nthFriday(45);
  const exp30 = nthFriday(30);
  const exp60 = nthFriday(60);

  const strategies: OptionsStrategy[] = [];

  if (outlook === "bullish") {
    const highIv = ivRank >= 45;

    if (highIv) {
      // Bull Put Spread — sell credit when IV is rich
      const shortStrike = round2(atm(currentPrice, -1));   // 1 strike OTM
      const longStrike  = round2(atm(currentPrice, -3));   // 3 strikes OTM
      const shortPrem   = bsCall(currentPrice, shortStrike, 0.045, iv, 45 / 365, "put");
      const longPrem    = bsCall(currentPrice, longStrike,  0.045, iv, 45 / 365, "put");
      const credit      = round2((shortPrem - longPrem) * 100);
      const maxLoss     = round2((shortStrike - longStrike - (shortPrem - longPrem)) * 100);
      const rr          = credit / maxLoss;

      strategies.push(makeStrategy(1, symbol, "bull_put_spread", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} ${fmt(shortStrike)}/${fmt(longStrike)} Bull Put Spread`,
        type: "income",
        exp: exp45.date,
        legs: [
          { action: "sell", optionType: "put", strikePrice: shortStrike, premium: round2(shortPrem), quantity: 1, expiration: exp45.date },
          { action: "buy",  optionType: "put", strikePrice: longStrike,  premium: round2(longPrem),  quantity: 1, expiration: exp45.date },
        ],
        tradeCost: credit,
        maxProfit: credit,
        maxLoss: -maxLoss,
        breakeven: round2(shortStrike - (shortPrem - longPrem)),
        returnPercent: round2((credit / maxLoss) * 100),
        rrRatio: rr,
        probProfit: deltaToProb(0.30),
        ivAlignment: highIv ? 1 : 0.5,
      }));

      // Covered Call (income)
      const callStrike = round2(atm(currentPrice, 2));
      const callPrem   = round2(bsCall(currentPrice, callStrike, 0.045, iv, 30 / 365, "call") * 100);
      strategies.push(makeStrategy(2, symbol, "covered_call", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp30.label} ${fmt(callStrike)} Covered Call`,
        type: "income",
        exp: exp30.date,
        legs: [
          { action: "buy",  optionType: "stock", strikePrice: currentPrice, premium: 0, quantity: 100, expiration: exp30.date },
          { action: "sell", optionType: "call",  strikePrice: callStrike, premium: round2(callPrem / 100), quantity: 1, expiration: exp30.date },
        ],
        tradeCost: round2(-(currentPrice * 100 - callPrem)),
        maxProfit: round2((callStrike - currentPrice) * 100 + callPrem),
        maxLoss: round2(-(currentPrice * 100 - callPrem)),
        breakeven: round2(currentPrice - callPrem / 100),
        returnPercent: round2((callPrem / (currentPrice * 100)) * 100),
        rrRatio: callPrem / (currentPrice * 100),
        probProfit: deltaToProb(0.25),
        ivAlignment: highIv ? 1 : 0.6,
      }));
    } else {
      // Bull Call Spread — buy debit when IV is low
      const longStrike  = round2(atm(currentPrice, 0));
      const shortStrike = round2(atm(currentPrice, 4));
      const longPrem    = bsCall(currentPrice, longStrike,  0.045, iv, 45 / 365, "call");
      const shortPrem   = bsCall(currentPrice, shortStrike, 0.045, iv, 45 / 365, "call");
      const debit       = round2((longPrem - shortPrem) * 100);
      const maxProfit   = round2((shortStrike - longStrike) * 100 - debit);

      strategies.push(makeStrategy(1, symbol, "bull_call_spread", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} ${fmt(longStrike)}/${fmt(shortStrike)} Bull Call Spread`,
        type: "trade",
        exp: exp45.date,
        legs: [
          { action: "buy",  optionType: "call", strikePrice: longStrike,  premium: round2(longPrem),  quantity: 1, expiration: exp45.date },
          { action: "sell", optionType: "call", strikePrice: shortStrike, premium: round2(shortPrem), quantity: 1, expiration: exp45.date },
        ],
        tradeCost: -debit,
        maxProfit,
        maxLoss: -debit,
        breakeven: round2(longStrike + debit / 100),
        returnPercent: round2((maxProfit / debit) * 100),
        rrRatio: maxProfit / debit,
        probProfit: deltaToProb(0.45),
        ivAlignment: !highIv ? 1 : 0.5,
      }));

      // Long Call
      const callPrem = round2(bsCall(currentPrice, longStrike, 0.045, iv, 45 / 365, "call") * 100);
      strategies.push(makeStrategy(2, symbol, "long_call", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} ${fmt(longStrike)} Call`,
        type: "trade",
        exp: exp45.date,
        legs: [
          { action: "buy", optionType: "call", strikePrice: longStrike, premium: round2(callPrem / 100), quantity: 1, expiration: exp45.date },
        ],
        tradeCost: -callPrem,
        maxProfit: round2((currentPrice * 0.20) * 100 - callPrem),
        maxLoss: -callPrem,
        breakeven: round2(longStrike + callPrem / 100),
        returnPercent: round2(((currentPrice * 0.10) / (callPrem / 100)) * 100),
        rrRatio: (currentPrice * 0.15 * 100) / callPrem,
        probProfit: deltaToProb(0.50),
        ivAlignment: !highIv ? 0.9 : 0.4,
      }));
    }

    // Always add a stock trade as option 3
    strategies.push(makeStrategy(3, symbol, "long_stock", outlook, currentPrice, iv, ivRank, signals, {
      name: `Buy 100 Shares`,
      type: "trade",
      exp: exp45.date,
      legs: [{ action: "buy", optionType: "stock", strikePrice: currentPrice, premium: 0, quantity: 100, expiration: exp45.date }],
      tradeCost: round2(-currentPrice * 100),
      maxProfit: round2(currentPrice * 0.25 * 100),
      maxLoss: round2(-currentPrice * 100),
      breakeven: currentPrice,
      returnPercent: round2(signals.strength * 2.5),
      rrRatio: 0.25,
      probProfit: 0.52,
      ivAlignment: 0.5,
    }));
  }

  if (outlook === "bearish") {
    const highIv = ivRank >= 45;

    if (highIv) {
      // Bear Call Spread — credit
      const shortStrike = round2(atm(currentPrice, 1));
      const longStrike  = round2(atm(currentPrice, 3));
      const shortPrem   = bsCall(currentPrice, shortStrike, 0.045, iv, 45 / 365, "call");
      const longPrem    = bsCall(currentPrice, longStrike,  0.045, iv, 45 / 365, "call");
      const credit      = round2((shortPrem - longPrem) * 100);
      const maxLoss     = round2((longStrike - shortStrike) * 100 - credit);

      strategies.push(makeStrategy(1, symbol, "bear_call_spread", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} ${fmt(shortStrike)}/${fmt(longStrike)} Bear Call Spread`,
        type: "income",
        exp: exp45.date,
        legs: [
          { action: "sell", optionType: "call", strikePrice: shortStrike, premium: round2(shortPrem), quantity: 1, expiration: exp45.date },
          { action: "buy",  optionType: "call", strikePrice: longStrike,  premium: round2(longPrem),  quantity: 1, expiration: exp45.date },
        ],
        tradeCost: credit,
        maxProfit: credit,
        maxLoss: -maxLoss,
        breakeven: round2(shortStrike + (shortPrem - longPrem)),
        returnPercent: round2((credit / maxLoss) * 100),
        rrRatio: credit / maxLoss,
        probProfit: deltaToProb(0.32),
        ivAlignment: highIv ? 1 : 0.5,
      }));
    } else {
      // Bear Put Spread — debit
      const longStrike  = round2(atm(currentPrice, 0));
      const shortStrike = round2(atm(currentPrice, -4));
      const longPrem    = bsCall(currentPrice, longStrike,  0.045, iv, 45 / 365, "put");
      const shortPrem   = bsCall(currentPrice, shortStrike, 0.045, iv, 45 / 365, "put");
      const debit       = round2((longPrem - shortPrem) * 100);
      const maxProfit   = round2((longStrike - shortStrike) * 100 - debit);

      strategies.push(makeStrategy(1, symbol, "bear_put_spread", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} ${fmt(longStrike)}/${fmt(shortStrike)} Bear Put Spread`,
        type: "trade",
        exp: exp45.date,
        legs: [
          { action: "buy",  optionType: "put", strikePrice: longStrike,  premium: round2(longPrem),  quantity: 1, expiration: exp45.date },
          { action: "sell", optionType: "put", strikePrice: shortStrike, premium: round2(shortPrem), quantity: 1, expiration: exp45.date },
        ],
        tradeCost: -debit,
        maxProfit,
        maxLoss: -debit,
        breakeven: round2(longStrike - debit / 100),
        returnPercent: round2((maxProfit / debit) * 100),
        rrRatio: maxProfit / debit,
        probProfit: deltaToProb(0.45),
        ivAlignment: !highIv ? 1 : 0.5,
      }));
    }

    // Long Put
    const putStrike = round2(atm(currentPrice, -1));
    const putPrem   = round2(bsCall(currentPrice, putStrike, 0.045, iv, 45 / 365, "put") * 100);
    strategies.push(makeStrategy(2, symbol, "long_put", outlook, currentPrice, iv, ivRank, signals, {
      name: `${exp45.label} ${fmt(putStrike)} Put`,
      type: "trade",
      exp: exp45.date,
      legs: [{ action: "buy", optionType: "put", strikePrice: putStrike, premium: round2(putPrem / 100), quantity: 1, expiration: exp45.date }],
      tradeCost: -putPrem,
      maxProfit: round2(putStrike * 100 - putPrem),
      maxLoss: -putPrem,
      breakeven: round2(putStrike - putPrem / 100),
      returnPercent: round2(((putStrike * 0.10) / (putPrem / 100)) * 100),
      rrRatio: (putStrike * 0.15 * 100) / putPrem,
      probProfit: deltaToProb(0.48),
      ivAlignment: !highIv ? 0.9 : 0.4,
    }));

    // Short stock
    strategies.push(makeStrategy(3, symbol, "short_stock", outlook, currentPrice, iv, ivRank, signals, {
      name: `Sell 100 Shares Short`,
      type: "trade",
      exp: exp45.date,
      legs: [{ action: "sell", optionType: "stock", strikePrice: currentPrice, premium: 0, quantity: 100, expiration: exp45.date }],
      tradeCost: round2(currentPrice * 100),
      maxProfit: round2(currentPrice * 0.25 * 100),
      maxLoss: round2(-currentPrice * 100),
      breakeven: currentPrice,
      returnPercent: round2(signals.strength * 2),
      rrRatio: 0.25,
      probProfit: 0.48,
      ivAlignment: 0.5,
    }));
  }

  if (outlook === "neutral") {
    const highIv = ivRank >= 40;

    if (highIv) {
      // Iron Condor
      const callShort = round2(atm(currentPrice, 2));
      const callLong  = round2(atm(currentPrice, 4));
      const putShort  = round2(atm(currentPrice, -2));
      const putLong   = round2(atm(currentPrice, -4));
      const csPrem    = bsCall(currentPrice, callShort, 0.045, iv, 45 / 365, "call");
      const clPrem    = bsCall(currentPrice, callLong,  0.045, iv, 45 / 365, "call");
      const psPrem    = bsCall(currentPrice, putShort,  0.045, iv, 45 / 365, "put");
      const plPrem    = bsCall(currentPrice, putLong,   0.045, iv, 45 / 365, "put");
      const credit    = round2(((csPrem - clPrem) + (psPrem - plPrem)) * 100);
      const wing      = round2((callShort - putShort) / 2 * 100);
      const maxLoss   = round2(wing * 100 - credit);

      strategies.push(makeStrategy(1, symbol, "iron_condor", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} Iron Condor ${fmt(putShort)}/${fmt(callShort)}`,
        type: "income",
        exp: exp45.date,
        legs: [
          { action: "sell", optionType: "call", strikePrice: callShort, premium: round2(csPrem), quantity: 1, expiration: exp45.date },
          { action: "buy",  optionType: "call", strikePrice: callLong,  premium: round2(clPrem), quantity: 1, expiration: exp45.date },
          { action: "sell", optionType: "put",  strikePrice: putShort,  premium: round2(psPrem), quantity: 1, expiration: exp45.date },
          { action: "buy",  optionType: "put",  strikePrice: putLong,   premium: round2(plPrem), quantity: 1, expiration: exp45.date },
        ],
        tradeCost: credit,
        maxProfit: credit,
        maxLoss: -maxLoss,
        breakeven: round2(putShort - credit / 100),
        returnPercent: round2((credit / maxLoss) * 100),
        rrRatio: credit / maxLoss,
        probProfit: deltaToProb(0.30),
        ivAlignment: highIv ? 1 : 0.3,
      }));

      // Short Strangle
      const strCallStrike = callShort;
      const strPutStrike  = putShort;
      const strCredit     = round2((csPrem + psPrem) * 100);
      strategies.push(makeStrategy(2, symbol, "short_strangle", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} ${fmt(strPutStrike)}/${fmt(strCallStrike)} Strangle`,
        type: "income",
        exp: exp45.date,
        legs: [
          { action: "sell", optionType: "call", strikePrice: strCallStrike, premium: round2(csPrem), quantity: 1, expiration: exp45.date },
          { action: "sell", optionType: "put",  strikePrice: strPutStrike,  premium: round2(psPrem), quantity: 1, expiration: exp45.date },
        ],
        tradeCost: strCredit,
        maxProfit: strCredit,
        maxLoss: round2(-strCredit * 3),
        breakeven: round2(strPutStrike - strCredit / 100),
        returnPercent: round2((strCredit / (strCredit * 3)) * 100),
        rrRatio: 1 / 3,
        probProfit: deltaToProb(0.25),
        ivAlignment: highIv ? 1 : 0.3,
      }));
    } else {
      // Long Straddle
      const atmStrike = round2(atm(currentPrice, 0));
      const callPrem  = round2(bsCall(currentPrice, atmStrike, 0.045, iv, 45 / 365, "call") * 100);
      const putPrem   = round2(bsCall(currentPrice, atmStrike, 0.045, iv, 45 / 365, "put") * 100);
      const totalDebit = round2(callPrem + putPrem);

      strategies.push(makeStrategy(1, symbol, "long_straddle", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} ${fmt(atmStrike)} Straddle`,
        type: "trade",
        exp: exp45.date,
        legs: [
          { action: "buy", optionType: "call", strikePrice: atmStrike, premium: round2(callPrem / 100), quantity: 1, expiration: exp45.date },
          { action: "buy", optionType: "put",  strikePrice: atmStrike, premium: round2(putPrem / 100),  quantity: 1, expiration: exp45.date },
        ],
        tradeCost: -totalDebit,
        maxProfit: round2(currentPrice * 0.20 * 100),
        maxLoss: -totalDebit,
        breakeven: round2(atmStrike + totalDebit / 100),
        returnPercent: round2(((currentPrice * 0.08) / (totalDebit / 100)) * 100),
        rrRatio: (currentPrice * 0.15 * 100) / totalDebit,
        probProfit: 0.45,
        ivAlignment: !highIv ? 1 : 0.3,
      }));
    }

    // Calendar Spread
    const calStrike = round2(atm(currentPrice, 0));
    const frontPrem = bsCall(currentPrice, calStrike, 0.045, iv, 30 / 365, "call");
    const backPrem  = bsCall(currentPrice, calStrike, 0.045, iv, 60 / 365, "call");
    const calDebit  = round2((backPrem - frontPrem) * 100);
    strategies.push(makeStrategy(2, symbol, "calendar_spread", outlook, currentPrice, iv, ivRank, signals, {
      name: `${exp30.label}/${exp60.label} ${fmt(calStrike)} Calendar`,
      type: "income",
      exp: exp60.date,
      legs: [
        { action: "sell", optionType: "call", strikePrice: calStrike, premium: round2(frontPrem), quantity: 1, expiration: exp30.date },
        { action: "buy",  optionType: "call", strikePrice: calStrike, premium: round2(backPrem),  quantity: 1, expiration: exp60.date },
      ],
      tradeCost: -calDebit,
      maxProfit: round2(calDebit * 1.8),
      maxLoss: -calDebit,
      breakeven: round2(calStrike - calDebit / 100),
      returnPercent: round2(80),
      rrRatio: 1.8,
      probProfit: 0.48,
      ivAlignment: 0.7,
    }));
  }

  return strategies.slice(0, 3);
}

// ─── Scoring ──────────────────────────────────────────────────────────────

interface StrategyParams {
  name: string;
  type: "trade" | "income";
  exp: string;
  legs: StrategyLeg[];
  tradeCost: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  returnPercent: number;
  rrRatio: number;       // max_profit / max_loss
  probProfit: number;    // 0-1
  ivAlignment: number;   // 0-1 (how well IV matches the strategy)
}

function makeStrategy(
  id: number,
  symbol: string,
  stratType: string,
  outlook: Outlook,
  price: number,
  iv: number,
  ivRank: number,
  signals: TechnicalSignals,
  params: StrategyParams
): OptionsStrategy {
  const score = computeScore(params, signals, outlook);
  return {
    id,
    name: params.name,
    type: params.type,
    outlook,
    description: buildDescription(stratType, symbol, outlook, price),
    legs: params.legs,
    tradeCost: round2(params.tradeCost),
    maxProfit: round2(params.maxProfit),
    maxLoss: round2(params.maxLoss),
    returnPercent: round2(params.returnPercent),
    breakeven: round2(params.breakeven),
    score,
    expirationDate: params.exp,
  };
}

function computeScore(params: StrategyParams, signals: TechnicalSignals, outlook: Outlook): number {
  // 1. Risk/Reward (0–60): higher R/R = better
  const rr = Math.abs(params.rrRatio);
  const rrScore = Math.min(60, rr * 25);

  // 2. Probability of Profit (0–60)
  const probScore = Math.min(60, params.probProfit * 80);

  // 3. IV Alignment (0–40): right strategy for the volatility environment
  const ivScore = params.ivAlignment * 40;

  // 4. Technical Alignment (0–40): technicals confirm strategy direction
  const techAlign = calcTechAlignment(signals, outlook);
  const techScore = techAlign * 40;

  const raw = rrScore + probScore + ivScore + techScore;
  return Math.min(200, Math.max(20, Math.round(raw)));
}

function calcTechAlignment(signals: TechnicalSignals, outlook: Outlook): number {
  let score = 0;
  let factors = 0;

  if (outlook === "bullish") {
    if (signals.trend === "bullish") score += 1; factors++;
    if (signals.rsi14 > 50 && signals.rsi14 < 70) score += 1; factors++;
    if (signals.macd.histogram > 0) score += 1; factors++;
    score += signals.strength / 10; factors++;
  } else if (outlook === "bearish") {
    if (signals.trend === "bearish") score += 1; factors++;
    if (signals.rsi14 < 50 && signals.rsi14 > 30) score += 1; factors++;
    if (signals.macd.histogram < 0) score += 1; factors++;
    score += (10 - signals.strength) / 10; factors++;
  } else {
    // Neutral: want RSI near 50 and low vol
    if (signals.rsi14 >= 40 && signals.rsi14 <= 60) score += 1; factors++;
    if (signals.volumeRatio < 1.2) score += 0.8; factors++;
    score += 0.6; factors++;
  }

  return factors > 0 ? Math.min(1, score / factors) : 0.5;
}

// ─── Black-Scholes Premium Approximation ─────────────────────────────────

function bsCall(S: number, K: number, r: number, sigma: number, T: number, type: "call" | "put"): number {
  if (T <= 0) return Math.max(0, type === "call" ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const Nd1 = normalCDF(d1), Nd2 = normalCDF(d2);
  if (type === "call") {
    return S * Nd1 - K * Math.exp(-r * T) * Nd2;
  } else {
    return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
  }
}

function normalCDF(x: number): number {
  const a = 0.2316419;
  const k = 1 / (1 + a * Math.abs(x));
  const poly = k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  const phi = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const prob = 1 - phi * poly;
  return x >= 0 ? prob : 1 - prob;
}

function deltaToProb(delta: number): number {
  // Rough: probability of profit ≈ 1 - |delta| for OTM options
  return Math.min(0.95, Math.max(0.15, 1 - Math.abs(delta)));
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function atm(price: number, strikesOtm: number): number {
  // Round to nearest $2.5 strike increment (common for most stocks)
  const increment = price < 50 ? 1 : price < 200 ? 2.5 : 5;
  const base = Math.round(price / increment) * increment;
  return base + strikesOtm * increment;
}

function fmt(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nthFriday(targetDte: number): { date: string; label: string } {
  const d = new Date();
  d.setDate(d.getDate() + targetDte);
  // Roll to nearest Friday
  const dow = d.getDay();
  if (dow !== 5) d.setDate(d.getDate() + ((5 - dow + 7) % 7));
  const date = d.toISOString().split("T")[0]!;
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { date, label };
}

function buildDescription(type: string, symbol: string, outlook: Outlook, price: number): string {
  const map: Record<string, string> = {
    bull_put_spread: `Sell a put spread below current price to collect premium with defined risk. Profits if ${symbol} stays above short strike.`,
    covered_call: `Buy shares and sell a call to reduce cost basis and generate income. Profits in flat-to-slightly-bullish conditions.`,
    bull_call_spread: `Buy a call spread to define risk while participating in upside. Lower cost than a long call.`,
    long_call: `Buy a call option to leverage bullish move in ${symbol} with defined maximum loss.`,
    long_stock: `Buy 100 shares of ${symbol} to participate directly in price appreciation.`,
    bear_call_spread: `Sell a call spread above current price to collect premium when bearish. Profits if ${symbol} stays below short strike.`,
    bear_put_spread: `Buy a put spread to profit from downside with defined risk. Lower cost than a long put.`,
    long_put: `Buy a put option to profit from a decline in ${symbol} with defined maximum loss.`,
    short_stock: `Short 100 shares of ${symbol} to profit from a decline in price.`,
    iron_condor: `Sell an iron condor to collect premium in a range-bound market. Profits if ${symbol} stays between the short strikes.`,
    short_strangle: `Sell both a call and put OTM to collect premium. High IV makes this attractive but risk is elevated.`,
    long_straddle: `Buy both a call and put at-the-money. Profits from a large move in either direction.`,
    calendar_spread: `Sell a near-term option and buy a longer-dated one at the same strike. Profits from time decay differential.`,
  };
  return map[type] ?? `${outlook.charAt(0).toUpperCase() + outlook.slice(1)} options strategy on ${symbol}.`;
}

// ─── P&L Curve using real options math ───────────────────────────────────

export interface PnlPoint { price: number; pnl: number }

export function calcPnlCurve(
  legs: StrategyLeg[],
  currentPrice: number,
  targetDate: string | undefined,
  impliedVolatility: number,
  riskFreeRate = 0.045
): { profitLoss: number; profitLossPercent: number; breakeven: number; maxProfit: number; maxLoss: number; pnlCurve: PnlPoint[] } {
  const today = new Date();
  const target = targetDate ? new Date(targetDate) : new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
  const dte = Math.max(0, (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const T = dte / 365;
  const iv = impliedVolatility / 100;

  const points = 60;
  const lo = currentPrice * 0.70;
  const hi = currentPrice * 1.30;
  const step = (hi - lo) / points;

  const curve: PnlPoint[] = [];
  for (let i = 0; i <= points; i++) {
    const p = lo + i * step;
    let value = 0;
    for (const leg of legs) {
      if (leg.optionType === "stock") {
        value += (p - leg.strikePrice) * leg.quantity * (leg.action === "buy" ? 1 : -1);
      } else {
        const optVal = bsCall(p, leg.strikePrice, riskFreeRate, iv, T, leg.optionType as "call" | "put") * 100;
        const openVal = leg.premium * 100;
        const pnlLeg  = (optVal - openVal) * (leg.action === "buy" ? 1 : -1);
        value += pnlLeg;
      }
    }
    curve.push({ price: round2(p), pnl: round2(value) });
  }

  // P&L at target price = currentPrice
  const atCurrent = curve.reduce((best, pt) => Math.abs(pt.price - currentPrice) < Math.abs(best.price - currentPrice) ? pt : best, curve[0]!);
  const pnlPcts = curve.map((pt) => pt.pnl);

  // Find breakeven
  let breakeven = currentPrice;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!, b = curve[i + 1]!;
    if ((a.pnl < 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl < 0)) {
      breakeven = round2(a.price + (b.price - a.price) * (-a.pnl / (b.pnl - a.pnl)));
      break;
    }
  }

  const totalCost = legs.reduce((s, l) => s + l.premium * 100 * (l.action === "buy" ? 1 : -1), 0);
  const profitLossPercent = totalCost !== 0 ? round2((atCurrent.pnl / Math.abs(totalCost)) * 100) : 0;

  return {
    profitLoss: round2(atCurrent.pnl),
    profitLossPercent,
    breakeven,
    maxProfit: round2(Math.max(...pnlPcts)),
    maxLoss: round2(Math.min(...pnlPcts)),
    pnlCurve: curve,
  };
}
