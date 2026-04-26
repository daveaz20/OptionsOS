/**
 * Options Strategy Engine — OptionsPlay-inspired methodology
 *
 * Strategy selection rules (IV Rank × Outlook matrix):
 *
 *  Outlook  | IV Rank    | Strategy
 *  ─────────────────────────────────────────────────────────────
 *  Bullish  | High ≥45   | Bull Put Spread (3 tiers: 20/30/40Δ) + Covered Call
 *  Bullish  | Low <45    | Bull Call Spread (std) + Long Call
 *  Bearish  | High ≥45   | Bear Call Spread (3 tiers: 20/30/40Δ) + Long Put
 *  Bearish  | Low <45    | Bear Put Spread (std) + Long Put
 *  Neutral  | High ≥40   | Iron Condor (3 tiers: 15/20/25Δ) + Short Strangle
 *  Neutral  | Low <40    | Long Straddle + Calendar Spread
 *
 * Score (0–100) methodology — 5 factors, each 0–10:
 *  - Technical alignment:    0–10 pts  (trend/RSI/MACD confirm direction)
 *  - IV alignment:           0–10 pts  (IV environment matches strategy type)
 *  - Risk/Reward ratio:      0–10 pts  (max_profit / max_loss)
 *  - Probability of profit:  0–10 pts  (based on BS delta of short strike)
 *  - Earnings risk:          0–10 pts  (10 = safe distance, 1 = eve of earnings)
 *  Weighted: tech 20% · iv 25% · rr 20% · pop 15% · earningsRisk 20%
 */

import type { TechnicalSignals } from "./technical-analysis.js";

export type ContractLookup = (
  type: "call" | "put",
  strike: number,
  expiry: string,
) => { mid: number; iv: number } | null;

export interface StrategyLeg {
  action: "buy" | "sell";
  optionType: "call" | "put" | "stock";
  strikePrice: number;
  premium: number;
  quantity: number;
  expiration: string;
}

export interface StrategyGreeks {
  delta: number;   // net position delta (share-equivalent exposure)
  theta: number;   // $/day (positive = earning time decay)
  vega: number;    // $/1% IV move (negative = hurt by IV spike)
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
  breakeven2?: number;          // upper breakeven for two-sided strategies
  score: number;                // 0–100 composite
  technicalScore: number;       // 0–10
  ivScore: number;              // 0–10
  rrScore: number;              // 0–10
  popScore: number;             // 0–10
  earningsRiskScore: number;    // 0–10 (10 = safe, 1 = eve of earnings)
  probProfit: number;           // 0–1 real BS-derived probability of profit
  greeks: StrategyGreeks;       // net position Greeks
  expectedValue: number;        // EV in $ per contract
  tier: "conservative" | "standard" | "aggressive";
  expirationDate: string;
}

type Outlook = "bullish" | "bearish" | "neutral";

export interface StrategyRiskPreferences {
  riskMinDTE: number;
  riskMaxDTE: number;
}

export const DEFAULT_STRATEGY_RISK_PREFERENCES: StrategyRiskPreferences = {
  riskMinDTE: 21,
  riskMaxDTE: 60,
};

// ─── Tier delta targets ──────────────────────────────────────────────────────

const CREDIT_SPREAD_TIERS = [
  { tier: "conservative" as const, shortD: 0.20, longD: 0.10 },
  { tier: "standard"     as const, shortD: 0.30, longD: 0.15 },
  { tier: "aggressive"   as const, shortD: 0.40, longD: 0.20 },
];

const CONDOR_TIERS = [
  { tier: "conservative" as const, shortD: 0.15, longD: 0.08 },
  { tier: "standard"     as const, shortD: 0.20, longD: 0.10 },
  { tier: "aggressive"   as const, shortD: 0.25, longD: 0.13 },
];

// ─── buildStrategies ─────────────────────────────────────────────────────────

export function buildStrategies(
  symbol: string,
  currentPrice: number,
  ivRank: number,
  hv30: number,         // realized vol as decimal (e.g. 0.28)
  signals: TechnicalSignals,
  outlook: Outlook,
  lookupContract?: ContractLookup,
  riskPreferences: StrategyRiskPreferences = DEFAULT_STRATEGY_RISK_PREFERENCES,
  daysToEarnings?: number,
): OptionsStrategy[] {
  const realPrem = (type: "call" | "put", strike: number, expiry: string, bsFallback: number): number => {
    const real = lookupContract?.(type, strike, expiry);
    return real?.mid ?? bsFallback;
  };

  // IV proxy: inflate HV30 slightly for option premium approximation
  const iv = Math.max(hv30 / 100, 0.15) * 1.15;

  const minDte = Math.max(0, Math.floor(riskPreferences.riskMinDTE));
  const maxDte = Math.max(minDte + 1, Math.floor(riskPreferences.riskMaxDTE));
  const targetDte = clampDte(45, minDte, maxDte);
  const nearDte   = clampDte(30, minDte, maxDte);
  const farDte    = maxDte > nearDte ? clampDte(60, nearDte + 1, maxDte) : maxDte;

  const exp45 = nthFridayWithin(targetDte, minDte, maxDte);
  const exp30 = nthFridayWithin(nearDte,   minDte, maxDte);
  const exp60 = nthFridayWithin(farDte,    minDte, maxDte);

  // Actual T values (years) from today to each expiry
  const now = Date.now();
  const T45 = Math.max(1 / 365, daysBetween(now, new Date(exp45.date).getTime()) / 365);
  const T30 = Math.max(1 / 365, daysBetween(now, new Date(exp30.date).getTime()) / 365);
  const T60 = Math.max(1 / 365, daysBetween(now, new Date(exp60.date).getTime()) / 365);

  const strategies: OptionsStrategy[] = [];
  const ms = (id: number, sym: string, stype: string, ol: Outlook, p: number, v: number, ivR: number, sig: TechnicalSignals, par: StrategyParams) =>
    makeStrategy(id, sym, stype, ol, p, v, ivR, sig, par, daysToEarnings);

  // ─── Bullish ───────────────────────────────────────────────────────────────
  if (outlook === "bullish") {
    const highIv = ivRank >= 45;

    if (highIv) {
      // Bull Put Spreads — 3 tiers by short-strike delta
      CREDIT_SPREAD_TIERS.forEach(({ tier, shortD, longD }, i) => {
        const shortStrike = strikeAtDelta(currentPrice, -shortD, iv, T45);
        const longStrike  = strikeAtDelta(currentPrice, -longD,  iv, T45);
        if (shortStrike <= longStrike) return;

        const shortPrem = realPrem("put", shortStrike, exp45.date, bsPrice(currentPrice, shortStrike, 0.045, iv, T45, "put"));
        const longPrem  = realPrem("put", longStrike,  exp45.date, bsPrice(currentPrice, longStrike,  0.045, iv, T45, "put"));
        const credit    = round2((shortPrem - longPrem) * 100);
        const width     = shortStrike - longStrike;
        const maxLoss   = round2((width - (shortPrem - longPrem)) * 100);
        const breakeven = round2(shortStrike - (shortPrem - longPrem));
        if (credit <= 0 || maxLoss <= 0) return;

        strategies.push(ms(i + 1, symbol, "bull_put_spread", outlook, currentPrice, iv, ivRank, signals, {
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
          breakeven,
          returnPercent: round2((credit / maxLoss) * 100),
          rrRatio: credit / maxLoss,
          popType: "above",
          ivAlignment: 1.0,
          tier,
        }));
      });

      // Covered Call (id=4)
      const ccStrike = strikeAtDelta(currentPrice, 0.25, iv, T30);
      const ccPremPerShare = realPrem("call", ccStrike, exp30.date, bsPrice(currentPrice, ccStrike, 0.045, iv, T30, "call"));
      const ccPrem = round2(ccPremPerShare * 100);
      const ccBE   = round2(currentPrice - ccPremPerShare);
      strategies.push(ms(4, symbol, "covered_call", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp30.label} ${fmt(ccStrike)} Covered Call`,
        type: "income",
        exp: exp30.date,
        legs: [
          { action: "buy",  optionType: "stock", strikePrice: currentPrice, premium: 0,                          quantity: 100, expiration: exp30.date },
          { action: "sell", optionType: "call",  strikePrice: ccStrike,     premium: round2(ccPremPerShare),     quantity: 1,   expiration: exp30.date },
        ],
        tradeCost:     round2(currentPrice * 100 - ccPrem),
        maxProfit:     round2((ccStrike - currentPrice) * 100 + ccPrem),
        maxLoss:       round2(-(currentPrice * 100 - ccPrem)),
        breakeven:     ccBE,
        returnPercent: round2((ccPrem / (currentPrice * 100)) * 100),
        rrRatio:       ccPrem / (currentPrice * 100),
        popType: "above",
        ivAlignment: 0.7,
        tier: "standard",
      }));

    } else {
      // Bull Call Spread (standard)
      const longStrike  = strikeAtDelta(currentPrice, 0.50, iv, T45);
      const shortStrike = strikeAtDelta(currentPrice, 0.25, iv, T45);
      const safeShort   = shortStrike > longStrike ? shortStrike : longStrike + strikeInc(currentPrice);

      const longPrem  = realPrem("call", longStrike, exp45.date, bsPrice(currentPrice, longStrike, 0.045, iv, T45, "call"));
      const shortPrem = realPrem("call", safeShort,  exp45.date, bsPrice(currentPrice, safeShort,  0.045, iv, T45, "call"));
      const debit     = round2((longPrem - shortPrem) * 100);
      const maxProfit = round2((safeShort - longStrike) * 100 - debit);
      const bcsBE     = round2(longStrike + debit / 100);
      if (debit > 0) {
        strategies.push(ms(1, symbol, "bull_call_spread", outlook, currentPrice, iv, ivRank, signals, {
          name: `${exp45.label} ${fmt(longStrike)}/${fmt(safeShort)} Bull Call Spread`,
          type: "trade",
          exp: exp45.date,
          legs: [
            { action: "buy",  optionType: "call", strikePrice: longStrike, premium: round2(longPrem),  quantity: 1, expiration: exp45.date },
            { action: "sell", optionType: "call", strikePrice: safeShort,  premium: round2(shortPrem), quantity: 1, expiration: exp45.date },
          ],
          tradeCost:     -debit,
          maxProfit,
          maxLoss:       -debit,
          breakeven:     bcsBE,
          returnPercent: round2((maxProfit / debit) * 100),
          rrRatio:       maxProfit / debit,
          popType: "above",
          ivAlignment: 0.9,
          tier: "standard",
        }));
      }

      // Long Call (id=2)
      const lcPremPerShare = realPrem("call", longStrike, exp45.date, bsPrice(currentPrice, longStrike, 0.045, iv, T45, "call"));
      const lcPrem = round2(lcPremPerShare * 100);
      const lcBE   = round2(longStrike + lcPremPerShare);
      strategies.push(ms(2, symbol, "long_call", outlook, currentPrice, iv, ivRank, signals, {
        name: `${exp45.label} ${fmt(longStrike)} Call`,
        type: "trade",
        exp: exp45.date,
        legs: [
          { action: "buy", optionType: "call", strikePrice: longStrike, premium: round2(lcPremPerShare), quantity: 1, expiration: exp45.date },
        ],
        tradeCost:     -lcPrem,
        maxProfit:     round2(currentPrice * 0.20 * 100 - lcPrem),
        maxLoss:       -lcPrem,
        breakeven:     lcBE,
        returnPercent: lcPrem > 0 ? round2((currentPrice * 0.10 / lcPremPerShare) * 100) : 0,
        rrRatio:       lcPrem > 0 ? (currentPrice * 0.15 * 100) / lcPrem : 0,
        popType: "above",
        ivAlignment: 0.8,
        tier: "standard",
      }));
    }
  }

  // ─── Bearish ───────────────────────────────────────────────────────────────
  if (outlook === "bearish") {
    const highIv = ivRank >= 45;

    if (highIv) {
      // Bear Call Spreads — 3 tiers
      CREDIT_SPREAD_TIERS.forEach(({ tier, shortD, longD }, i) => {
        const shortStrike = strikeAtDelta(currentPrice, shortD, iv, T45);
        const longStrike  = strikeAtDelta(currentPrice, longD,  iv, T45);
        if (longStrike <= shortStrike) return;

        const shortPrem = realPrem("call", shortStrike, exp45.date, bsPrice(currentPrice, shortStrike, 0.045, iv, T45, "call"));
        const longPrem  = realPrem("call", longStrike,  exp45.date, bsPrice(currentPrice, longStrike,  0.045, iv, T45, "call"));
        const credit    = round2((shortPrem - longPrem) * 100);
        const maxLoss   = round2((longStrike - shortStrike) * 100 - credit);
        const breakeven = round2(shortStrike + (shortPrem - longPrem));
        if (credit <= 0 || maxLoss <= 0) return;

        strategies.push(ms(i + 1, symbol, "bear_call_spread", outlook, currentPrice, iv, ivRank, signals, {
          name: `${exp45.label} ${fmt(shortStrike)}/${fmt(longStrike)} Bear Call Spread`,
          type: "income",
          exp: exp45.date,
          legs: [
            { action: "sell", optionType: "call", strikePrice: shortStrike, premium: round2(shortPrem), quantity: 1, expiration: exp45.date },
            { action: "buy",  optionType: "call", strikePrice: longStrike,  premium: round2(longPrem),  quantity: 1, expiration: exp45.date },
          ],
          tradeCost:     credit,
          maxProfit:     credit,
          maxLoss:       -maxLoss,
          breakeven,
          returnPercent: round2((credit / maxLoss) * 100),
          rrRatio:       credit / maxLoss,
          popType: "below",
          ivAlignment: 1.0,
          tier,
        }));
      });

    } else {
      // Bear Put Spread (standard)
      const longStrike  = strikeAtDelta(currentPrice, -0.50, iv, T45);
      const shortStrike = strikeAtDelta(currentPrice, -0.25, iv, T45);
      const safeLong    = longStrike > shortStrike ? longStrike : shortStrike + strikeInc(currentPrice);

      const longPrem  = realPrem("put", safeLong,     exp45.date, bsPrice(currentPrice, safeLong,     0.045, iv, T45, "put"));
      const shortPrem = realPrem("put", shortStrike,  exp45.date, bsPrice(currentPrice, shortStrike,  0.045, iv, T45, "put"));
      const debit     = round2((longPrem - shortPrem) * 100);
      const maxProfit = round2((safeLong - shortStrike) * 100 - debit);
      const bpsBE     = round2(safeLong - debit / 100);
      if (debit > 0) {
        strategies.push(ms(1, symbol, "bear_put_spread", outlook, currentPrice, iv, ivRank, signals, {
          name: `${exp45.label} ${fmt(safeLong)}/${fmt(shortStrike)} Bear Put Spread`,
          type: "trade",
          exp: exp45.date,
          legs: [
            { action: "buy",  optionType: "put", strikePrice: safeLong,    premium: round2(longPrem),  quantity: 1, expiration: exp45.date },
            { action: "sell", optionType: "put", strikePrice: shortStrike, premium: round2(shortPrem), quantity: 1, expiration: exp45.date },
          ],
          tradeCost:     -debit,
          maxProfit,
          maxLoss:       -debit,
          breakeven:     bpsBE,
          returnPercent: round2((maxProfit / debit) * 100),
          rrRatio:       maxProfit / debit,
          popType: "below",
          ivAlignment: 0.9,
          tier: "standard",
        }));
      }
    }

    // Long Put (always included, id=4 for highIv else id=2)
    const lpStrike = strikeAtDelta(currentPrice, -0.50, iv, T45);
    const lpPremPerShare = realPrem("put", lpStrike, exp45.date, bsPrice(currentPrice, lpStrike, 0.045, iv, T45, "put"));
    const lpPrem = round2(lpPremPerShare * 100);
    const lpBE   = round2(lpStrike - lpPremPerShare);
    strategies.push(ms(highIv ? 4 : 2, symbol, "long_put", outlook, currentPrice, iv, ivRank, signals, {
      name: `${exp45.label} ${fmt(lpStrike)} Put`,
      type: "trade",
      exp: exp45.date,
      legs: [
        { action: "buy", optionType: "put", strikePrice: lpStrike, premium: round2(lpPremPerShare), quantity: 1, expiration: exp45.date },
      ],
      tradeCost:     -lpPrem,
      maxProfit:     round2(lpStrike * 100 - lpPrem),
      maxLoss:       -lpPrem,
      breakeven:     lpBE,
      returnPercent: lpPrem > 0 ? round2((lpStrike * 0.10 / lpPremPerShare) * 100) : 0,
      rrRatio:       lpPrem > 0 ? (lpStrike * 0.15 * 100) / lpPrem : 0,
      popType: "below",
      ivAlignment: ivRank < 45 ? 0.85 : 0.4,
      tier: "standard",
    }));
  }

  // ─── Neutral ───────────────────────────────────────────────────────────────
  if (outlook === "neutral") {
    const highIv = ivRank >= 40;

    if (highIv) {
      // Iron Condors — 3 tiers
      CONDOR_TIERS.forEach(({ tier, shortD, longD }, i) => {
        const callShort = strikeAtDelta(currentPrice,  shortD, iv, T45);
        const callLong  = strikeAtDelta(currentPrice,  longD,  iv, T45);
        const putShort  = strikeAtDelta(currentPrice, -shortD, iv, T45);
        const putLong   = strikeAtDelta(currentPrice, -longD,  iv, T45);

        if (callLong <= callShort || putShort <= putLong) return;

        const csPrem = realPrem("call", callShort, exp45.date, bsPrice(currentPrice, callShort, 0.045, iv, T45, "call"));
        const clPrem = realPrem("call", callLong,  exp45.date, bsPrice(currentPrice, callLong,  0.045, iv, T45, "call"));
        const psPrem = realPrem("put",  putShort,  exp45.date, bsPrice(currentPrice, putShort,  0.045, iv, T45, "put"));
        const plPrem = realPrem("put",  putLong,   exp45.date, bsPrice(currentPrice, putLong,   0.045, iv, T45, "put"));
        const credit  = round2(((csPrem - clPrem) + (psPrem - plPrem)) * 100);
        const callWing = callLong - callShort;
        const putWing  = putShort - putLong;
        const maxLoss  = round2(Math.max(callWing, putWing) * 100 - credit);
        const beLower  = round2(putShort  - credit / 100);
        const beUpper  = round2(callShort + credit / 100);
        if (credit <= 0 || maxLoss <= 0) return;

        strategies.push(ms(i + 1, symbol, "iron_condor", outlook, currentPrice, iv, ivRank, signals, {
          name: `${exp45.label} Iron Condor ${fmt(putShort)}/${fmt(callShort)}`,
          type: "income",
          exp: exp45.date,
          legs: [
            { action: "sell", optionType: "call", strikePrice: callShort, premium: round2(csPrem), quantity: 1, expiration: exp45.date },
            { action: "buy",  optionType: "call", strikePrice: callLong,  premium: round2(clPrem), quantity: 1, expiration: exp45.date },
            { action: "sell", optionType: "put",  strikePrice: putShort,  premium: round2(psPrem), quantity: 1, expiration: exp45.date },
            { action: "buy",  optionType: "put",  strikePrice: putLong,   premium: round2(plPrem), quantity: 1, expiration: exp45.date },
          ],
          tradeCost:     credit,
          maxProfit:     credit,
          maxLoss:       -maxLoss,
          breakeven:     beLower,
          breakeven2:    beUpper,
          returnPercent: round2((credit / maxLoss) * 100),
          rrRatio:       credit / maxLoss,
          popType: "between",
          ivAlignment: 1.0,
          tier,
        }));
      });

      // Short Strangle (id=4)
      const ssCallStrike = strikeAtDelta(currentPrice,  0.20, iv, T45);
      const ssPutStrike  = strikeAtDelta(currentPrice, -0.20, iv, T45);
      const ssCsPrem     = realPrem("call", ssCallStrike, exp45.date, bsPrice(currentPrice, ssCallStrike, 0.045, iv, T45, "call"));
      const ssPsPrem     = realPrem("put",  ssPutStrike,  exp45.date, bsPrice(currentPrice, ssPutStrike,  0.045, iv, T45, "put"));
      const ssCredit     = round2((ssCsPrem + ssPsPrem) * 100);
      const ssBeLower    = round2(ssPutStrike  - ssCredit / 100);
      const ssBeUpper    = round2(ssCallStrike + ssCredit / 100);
      if (ssCredit > 0) {
        strategies.push(ms(4, symbol, "short_strangle", outlook, currentPrice, iv, ivRank, signals, {
          name: `${exp45.label} ${fmt(ssPutStrike)}/${fmt(ssCallStrike)} Strangle`,
          type: "income",
          exp: exp45.date,
          legs: [
            { action: "sell", optionType: "call", strikePrice: ssCallStrike, premium: round2(ssCsPrem), quantity: 1, expiration: exp45.date },
            { action: "sell", optionType: "put",  strikePrice: ssPutStrike,  premium: round2(ssPsPrem), quantity: 1, expiration: exp45.date },
          ],
          tradeCost:     ssCredit,
          maxProfit:     ssCredit,
          maxLoss:       round2(-ssCredit * 3),
          breakeven:     ssBeLower,
          breakeven2:    ssBeUpper,
          returnPercent: round2(1 / 3 * 100),
          rrRatio:       1 / 3,
          popType: "between",
          ivAlignment: 1.0,
          tier: "standard",
        }));
      }

    } else {
      // Long Straddle
      const atmStrike  = strikeAtDelta(currentPrice, 0.50, iv, T45);
      const stCallPrem = realPrem("call", atmStrike, exp45.date, bsPrice(currentPrice, atmStrike, 0.045, iv, T45, "call"));
      const stPutPrem  = realPrem("put",  atmStrike, exp45.date, bsPrice(currentPrice, atmStrike, 0.045, iv, T45, "put"));
      const stDebit    = round2((stCallPrem + stPutPrem) * 100);
      const stBeLower  = round2(atmStrike - (stCallPrem + stPutPrem));
      const stBeUpper  = round2(atmStrike + (stCallPrem + stPutPrem));
      if (stDebit > 0) {
        strategies.push(ms(1, symbol, "long_straddle", outlook, currentPrice, iv, ivRank, signals, {
          name: `${exp45.label} ${fmt(atmStrike)} Straddle`,
          type: "trade",
          exp: exp45.date,
          legs: [
            { action: "buy", optionType: "call", strikePrice: atmStrike, premium: round2(stCallPrem), quantity: 1, expiration: exp45.date },
            { action: "buy", optionType: "put",  strikePrice: atmStrike, premium: round2(stPutPrem),  quantity: 1, expiration: exp45.date },
          ],
          tradeCost:     -stDebit,
          maxProfit:     round2(currentPrice * 0.20 * 100),
          maxLoss:       -stDebit,
          breakeven:     stBeLower,
          breakeven2:    stBeUpper,
          returnPercent: stDebit > 0 ? round2((currentPrice * 0.08 / (stCallPrem + stPutPrem)) * 100) : 0,
          rrRatio:       stDebit > 0 ? (currentPrice * 0.15 * 100) / stDebit : 0,
          popType: "outside",
          ivAlignment: 1.0,
          tier: "standard",
        }));
      }
    }

    // Calendar Spread (id=2 for lowIv, id=5 for highIv — skip if same expiry)
    if (exp30.date !== exp60.date) {
      const calStrike = strikeAtDelta(currentPrice, 0.50, iv, T45);
      const frontPrem = realPrem("call", calStrike, exp30.date, bsPrice(currentPrice, calStrike, 0.045, iv, T30, "call"));
      const backPrem  = realPrem("call", calStrike, exp60.date, bsPrice(currentPrice, calStrike, 0.045, iv, T60, "call"));
      const calDebit  = round2((backPrem - frontPrem) * 100);
      const calBE     = round2(calStrike - calDebit / 100);
      if (calDebit > 0) {
        strategies.push(ms(highIv ? 5 : 2, symbol, "calendar_spread", outlook, currentPrice, iv, ivRank, signals, {
          name: `${exp30.label}/${exp60.label} ${fmt(calStrike)} Calendar`,
          type: "income",
          exp: exp60.date,
          legs: [
            { action: "sell", optionType: "call", strikePrice: calStrike, premium: round2(frontPrem), quantity: 1, expiration: exp30.date },
            { action: "buy",  optionType: "call", strikePrice: calStrike, premium: round2(backPrem),  quantity: 1, expiration: exp60.date },
          ],
          tradeCost:     -calDebit,
          maxProfit:     round2(calDebit * 1.8),
          maxLoss:       -calDebit,
          breakeven:     calBE,
          returnPercent: 80,
          rrRatio:       1.8,
          popType: "above",
          ivAlignment: highIv ? 0.4 : 0.7,
          tier: "standard",
        }));
      }
    }
  }

  return strategies
    .filter(strategy => {
      const dte = daysBetween(Date.now(), new Date(strategy.expirationDate).getTime());
      return dte >= minDte && dte <= maxDte;
    })
    .slice(0, 5);
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface StrategyParams {
  name: string;
  type: "trade" | "income";
  exp: string;
  legs: StrategyLeg[];
  tradeCost: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  breakeven2?: number;
  returnPercent: number;
  rrRatio: number;
  popType: "above" | "below" | "between" | "outside";
  ivAlignment: number;
  tier: "conservative" | "standard" | "aggressive";
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
  params: StrategyParams,
  daysToEarnings?: number,
): OptionsStrategy {
  const T = Math.max(1 / 365, daysBetween(Date.now(), new Date(params.exp).getTime()) / 365);
  const probProfit = computePOP(params, price, iv, T);
  const greeks     = positionGreeks(params.legs, price, iv, T);
  const expectedValue = round2(probProfit * params.maxProfit + (1 - probProfit) * params.maxLoss);
  const { score, technicalScore, ivScore, rrScore, popScore, earningsRiskScore } = computeScore(params, probProfit, signals, outlook, ivRank, daysToEarnings);

  return {
    id,
    name:              params.name,
    type:              params.type,
    outlook,
    description:       buildDescription(stratType, symbol, outlook, price, daysToEarnings),
    legs:              params.legs,
    tradeCost:         round2(params.tradeCost),
    maxProfit:         round2(params.maxProfit),
    maxLoss:           round2(params.maxLoss),
    returnPercent:     round2(params.returnPercent),
    breakeven:         round2(params.breakeven),
    breakeven2:        params.breakeven2 !== undefined ? round2(params.breakeven2) : undefined,
    score,
    technicalScore,
    ivScore,
    rrScore,
    popScore,
    earningsRiskScore,
    probProfit:        round2(probProfit),
    greeks,
    expectedValue,
    tier:              params.tier,
    expirationDate:    params.exp,
  };
}

function computeScore(
  params: StrategyParams,
  probProfit: number,
  signals: TechnicalSignals,
  outlook: Outlook,
  ivRank: number,
  daysToEarnings?: number,
): { score: number; technicalScore: number; ivScore: number; rrScore: number; popScore: number; earningsRiskScore: number } {
  const technicalScore    = calcTechGrade(signals, outlook);
  const ivScore           = calcIvGrade(ivRank, params.ivAlignment);
  const earningsRiskScore = calcEarningsRiskGrade(params, daysToEarnings);

  const rr = Math.abs(params.rrRatio);
  const rrScore =
    rr >= 2.0 ? 10.0 :
    rr >= 1.5 ? 8.5  :
    rr >= 1.0 ? 7.0  :
    rr >= 0.6 ? 5.0  :
    rr >= 0.3 ? 3.0  : 1.5;

  const popScore = Math.min(10, probProfit * 12);

  // Weighted composite: tech 20%, iv 25%, rr 20%, pop 15%, earningsRisk 20% → 0–100
  const raw = (technicalScore * 20 + ivScore * 25 + rrScore * 20 + popScore * 15 + earningsRiskScore * 20) / 100 * 10;
  const score = Math.min(100, Math.max(10, Math.round(raw)));

  return {
    score,
    technicalScore:    round1(technicalScore),
    ivScore:           round1(ivScore),
    rrScore:           round1(rrScore),
    popScore:          round1(popScore),
    earningsRiskScore: round1(earningsRiskScore),
  };
}

function calcEarningsRiskGrade(params: StrategyParams, daysToEarnings?: number): number {
  if (daysToEarnings === undefined) return 6.5;  // unknown — mild caution
  if (daysToEarnings < 0)          return 8.5;   // post-earnings: vol crush done
  if (daysToEarnings === 0)        return 2.0;   // earnings today

  // Credit-selling strategies (income, not covered call) actually benefit from IV expansion before earnings
  const isStock = params.legs.some(l => l.optionType === "stock");
  const creditSelling = params.type === "income" && params.tradeCost > 0 && !isStock;

  if (daysToEarnings > 30) return 10.0;
  if (daysToEarnings > 21) return 8.5;
  if (daysToEarnings > 14) return 7.0;
  if (daysToEarnings >  7) return creditSelling ? 6.0 : 3.0;
  if (daysToEarnings >= 3) return creditSelling ? 4.5 : 1.5;
  return 2.0;  // 1–2 days before earnings — very risky
}

function calcTechGrade(signals: TechnicalSignals, outlook: Outlook): number {
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
    const rsiNeutral = signals.rsi14 >= 43 && signals.rsi14 <= 57;
    const macdFlat   = Math.abs(signals.macd.histogram) < Math.abs(signals.macd.signal) * 0.25;

    if (rsiNeutral) score += 3.0;
    else if (signals.rsi14 >= 38 && signals.rsi14 <= 62) score += 1.5;

    if (macdFlat) score += 4.0;
    else if (Math.abs(signals.macd.histogram) < Math.abs(signals.macd.signal) * 0.5) score += 2.0;

    score += signals.trend === "neutral" ? 3.0 : 1.0;
  }

  return Math.min(10, score);
}

function calcIvGrade(ivRank: number, ivAlignment: number): number {
  const creditFit  = ivAlignment === 1;
  const debitFit   = ivAlignment >= 0.85;

  let base: number;
  if (creditFit) {
    if      (ivRank >= 70) base = 10.0;
    else if (ivRank >= 60) base = 8.5;
    else if (ivRank >= 50) base = 7.0;
    else if (ivRank >= 40) base = 5.5;
    else base = ivAlignment * 5;
  } else if (debitFit) {
    if      (ivRank <= 20) base = 10.0;
    else if (ivRank <= 30) base = 8.5;
    else if (ivRank <= 40) base = 7.0;
    else if (ivRank <= 50) base = 5.5;
    else base = ivAlignment * 5;
  } else {
    base = ivAlignment * 10;
  }

  return Math.min(10, Math.max(0, base));
}

// ─── Black-Scholes ────────────────────────────────────────────────────────────

function bsPrice(S: number, K: number, r: number, sigma: number, T: number, type: "call" | "put"): number {
  if (T <= 0) return Math.max(0, type === "call" ? S - K : K - S);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const Nd1 = normalCDF(d1), Nd2 = normalCDF(d2);
  if (type === "call") return S * Nd1 - K * Math.exp(-r * T) * Nd2;
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

function normalCDF(x: number): number {
  const a = 0.2316419;
  const k = 1 / (1 + a * Math.abs(x));
  const poly = k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  const phi = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const prob = 1 - phi * poly;
  return x >= 0 ? prob : 1 - prob;
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Inverse normal CDF — Acklam's algorithm (accurate to ~1e-9)
function invNorm(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;
  const a = [-3.969683028665376e+01,  2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00];
  const b = [-5.447609879822406e+01,  1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (pLow <= p && p <= pHigh) {
    const q = p - 0.5, r = q * q;
    return (q * (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])) /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  const q = Math.sqrt(-2 * Math.log(p < pLow ? p : 1 - p));
  const sign = p < pLow ? -1 : 1;
  return sign * (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// Analytical strike at a target delta
// targetDelta: positive = call delta (e.g. 0.30 for 30Δ call), negative = put delta (e.g. -0.30 for 30Δ put)
function strikeAtDelta(S: number, targetDelta: number, sigma: number, T: number, r = 0.045): number {
  const safeD  = Math.min(0.98, Math.max(0.02, Math.abs(targetDelta)));
  const eff    = targetDelta < 0 ? -safeD : safeD;
  const d1     = eff < 0 ? invNorm(1 + eff) : invNorm(eff);
  const K      = S * Math.exp(-d1 * sigma * Math.sqrt(T) + (r + 0.5 * sigma * sigma) * T);
  if (!isFinite(K) || K <= 0) return S;
  const inc = strikeInc(S);
  return Math.round(K / inc) * inc;
}

// Net position Greeks (delta, theta/day, vega per 1% IV)
function positionGreeks(legs: StrategyLeg[], S: number, sigma: number, T: number, r = 0.045): StrategyGreeks {
  let delta = 0, theta = 0, vega = 0;
  if (T > 0) {
    const sqrtT = Math.sqrt(T);
    for (const leg of legs) {
      const sign = leg.action === "buy" ? 1 : -1;
      const qty  = leg.quantity;
      if (leg.optionType === "stock") {
        delta += sign * qty;
        continue;
      }
      const K  = leg.strikePrice;
      const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
      const d2 = d1 - sigma * sqrtT;
      const phi = normalPDF(d1);
      const dK  = K * Math.exp(-r * T);
      const rawDelta = leg.optionType === "call" ? normalCDF(d1) : normalCDF(d1) - 1;
      // theta per share per year (convert to per day by /365)
      const rawTheta = (-(S * sigma * phi) / (2 * sqrtT) +
        (leg.optionType === "put"
          ? r * dK * normalCDF(-d2)
          : -r * dK * normalCDF(d2))) / 365;
      const rawVega = S * phi * sqrtT * 0.01;  // per 1% IV move, per share
      delta += rawDelta * sign * qty * 100;
      theta += rawTheta * sign * qty * 100;
      vega  += rawVega  * sign * qty * 100;
    }
  } else {
    for (const leg of legs) {
      if (leg.optionType === "stock") delta += (leg.action === "buy" ? 1 : -1) * leg.quantity;
    }
  }
  return { delta: round2(delta), theta: round2(theta), vega: round2(vega) };
}

// Probability of profit using Black-Scholes risk-neutral probabilities
function computePOP(params: StrategyParams, S: number, sigma: number, T: number, r = 0.045): number {
  if (T <= 0) return 0.5;
  const sqrtT = Math.sqrt(T);
  // nd2(K) = P(S_T > K) under risk-neutral measure
  const nd2 = (K: number) => normalCDF((Math.log(S / K) + (r - 0.5 * sigma * sigma) * T) / (sigma * sqrtT));

  switch (params.popType) {
    case "above":   return Math.min(0.97, Math.max(0.05, nd2(params.breakeven)));
    case "below":   return Math.min(0.97, Math.max(0.05, 1 - nd2(params.breakeven)));
    case "between": {
      if (!params.breakeven2) return 0.5;
      return Math.min(0.97, Math.max(0.05, nd2(params.breakeven) - nd2(params.breakeven2)));
    }
    case "outside": {
      if (!params.breakeven2) return 0.38;
      // P(S < lower_BE) + P(S > upper_BE)
      return Math.min(0.97, Math.max(0.05, (1 - nd2(params.breakeven)) + nd2(params.breakeven2)));
    }
    default: return 0.5;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function strikeInc(price: number): number {
  return price < 50 ? 1 : price < 200 ? 2.5 : 5;
}

function fmt(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

function nthFriday(targetDte: number): { date: string; label: string } {
  const d = new Date();
  d.setDate(d.getDate() + targetDte);
  const dow = d.getDay();
  if (dow !== 5) d.setDate(d.getDate() + ((5 - dow + 7) % 7));
  const date  = d.toISOString().split("T")[0]!;
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { date, label };
}

function nthFridayWithin(targetDte: number, minDte: number, maxDte: number): { date: string; label: string } {
  for (let dte = clampDte(targetDte, minDte, maxDte); dte >= minDte; dte -= 1) {
    const d = new Date();
    d.setDate(d.getDate() + dte);
    if (d.getDay() === 5) {
      const date  = d.toISOString().split("T")[0]!;
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return { date, label };
    }
  }
  return nthFriday(minDte);
}

function clampDte(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function daysBetween(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / 86_400_000);
}

function buildDescription(type: string, symbol: string, outlook: Outlook, price: number, daysToEarnings?: number): string {
  const map: Record<string, string> = {
    bull_put_spread:  `Sell a put spread below current price to collect premium with defined risk. Profits if ${symbol} stays above short strike.`,
    covered_call:     `Buy shares and sell a call to reduce cost basis and generate income. Profits in flat-to-slightly-bullish conditions.`,
    bull_call_spread: `Buy a call spread to define risk while participating in upside. Lower cost than a long call.`,
    long_call:        `Buy a call option to leverage bullish move in ${symbol} with defined maximum loss.`,
    bear_call_spread: `Sell a call spread above current price to collect premium when bearish. Profits if ${symbol} stays below short strike.`,
    bear_put_spread:  `Buy a put spread to profit from downside with defined risk. Lower cost than a long put.`,
    long_put:         `Buy a put option to profit from a decline in ${symbol} with defined maximum loss.`,
    iron_condor:      `Sell an iron condor to collect premium in a range-bound market. Profits if ${symbol} stays between the short strikes.`,
    short_strangle:   `Sell both a call and put OTM to collect premium. High IV makes this attractive but risk is elevated.`,
    long_straddle:    `Buy both a call and put at-the-money. Profits from a large move in either direction.`,
    calendar_spread:  `Sell a near-term option and buy a longer-dated one at the same strike. Profits from time decay differential.`,
  };
  let desc = map[type] ?? `${outlook.charAt(0).toUpperCase() + outlook.slice(1)} options strategy on ${symbol}.`;
  if (daysToEarnings !== undefined && daysToEarnings >= 0 && daysToEarnings <= 14) {
    desc += daysToEarnings <= 3
      ? ` ⚠ Earnings in ${daysToEarnings}d — IV is elevated; consider waiting for post-earnings vol crush.`
      : ` Earnings in ~${daysToEarnings}d — IV may expand further into the event.`;
  }
  return desc;
}

// ─── P&L Curve using real options math ───────────────────────────────────────

export interface PnlPoint { price: number; pnl: number }

export interface PnlCalculationSettings {
  commissionPerContract: number;
  perLegCommission: number;
  exchangeFeePerContract: number;
  includeCommissionsInPnl: boolean;
  includeFeesInBreakeven: boolean;
  contractMultiplier: number;
  pnlCurveResolution: number;
}

export const DEFAULT_PNL_CALCULATION_SETTINGS: PnlCalculationSettings = {
  commissionPerContract: 0.65,
  perLegCommission: 0,
  exchangeFeePerContract: 0.1,
  includeCommissionsInPnl: true,
  includeFeesInBreakeven: true,
  contractMultiplier: 100,
  pnlCurveResolution: 100,
};

export function calcPnlCurve(
  legs: StrategyLeg[],
  currentPrice: number,
  targetPrice: number,
  targetDate: string | undefined,
  impliedVolatility: number,
  riskFreeRate = 0.045,
  settings: PnlCalculationSettings = DEFAULT_PNL_CALCULATION_SETTINGS,
): { profitLoss: number; profitLossPercent: number; breakeven: number; maxProfit: number; maxLoss: number; pnlCurve: PnlPoint[] } {
  const firstLegExpiry = legs.find(l => l.optionType !== "stock")?.expiration;
  const target = targetDate
    ? new Date(targetDate)
    : firstLegExpiry
    ? new Date(firstLegExpiry)
    : new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);

  const iv = impliedVolatility / 100;
  const multiplier = Math.max(1, settings.contractMultiplier);
  const optionLegs = legs.filter(l => l.optionType !== "stock");
  const optionContracts = optionLegs.reduce((sum, leg) => sum + Math.abs(leg.quantity), 0);
  const commissionImpact = settings.includeCommissionsInPnl
    ? optionContracts * settings.commissionPerContract + optionLegs.length * settings.perLegCommission
    : 0;
  const feeImpact = optionContracts * settings.exchangeFeePerContract;
  const totalFeeImpact = commissionImpact + feeImpact;

  const lo = Math.min(currentPrice, targetPrice) * 0.72;
  const hi = Math.max(currentPrice, targetPrice) * 1.28;
  const points = Math.max(10, settings.pnlCurveResolution);
  const step = (hi - lo) / points;

  const evalLegs = (p: number, includeFees = true): number => {
    let value = 0;
    for (const leg of legs) {
      if (leg.optionType === "stock") {
        value += (p - leg.strikePrice) * leg.quantity * (leg.action === "buy" ? 1 : -1);
      } else {
        const legExpiry = (leg as any).expiration ?? firstLegExpiry;
        const legExpiryMs = legExpiry ? new Date(legExpiry).getTime() : target.getTime() + 45 * 24 * 60 * 60 * 1000;
        const legT = Math.max(0, (legExpiryMs - target.getTime()) / (365 * 24 * 60 * 60 * 1000));
        const optVal  = bsPrice(p, leg.strikePrice, riskFreeRate, iv, legT, leg.optionType as "call" | "put") * multiplier;
        const openVal = leg.premium * multiplier;
        value += (optVal - openVal) * (leg.action === "buy" ? 1 : -1) * leg.quantity;
      }
    }
    return value - (includeFees ? totalFeeImpact : 0);
  };

  const curve: PnlPoint[] = [];
  for (let i = 0; i <= points; i++) {
    const p = lo + i * step;
    curve.push({ price: round2(p), pnl: round2(evalLegs(p)) });
  }

  const pnlAtTarget = round2(evalLegs(targetPrice));
  const pnlPcts = curve.map((pt) => pt.pnl);

  let breakeven = currentPrice;
  const breakevenCurve = settings.includeFeesInBreakeven
    ? curve
    : curve.map((pt) => ({ price: pt.price, pnl: round2(evalLegs(pt.price, false)) }));
  for (let i = 0; i < breakevenCurve.length - 1; i++) {
    const a = breakevenCurve[i]!, b = breakevenCurve[i + 1]!;
    if ((a.pnl < 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl < 0)) {
      breakeven = round2(a.price + (b.price - a.price) * (-a.pnl / (b.pnl - a.pnl)));
      break;
    }
  }

  const totalCost = legs
    .filter(l => l.optionType !== "stock")
    .reduce((s, l) => s + l.premium * multiplier * (l.action === "buy" ? 1 : -1) * l.quantity, 0);
  const profitLossPercent = totalCost !== 0 ? round2((pnlAtTarget / Math.abs(totalCost)) * 100) : 0;

  return {
    profitLoss: pnlAtTarget,
    profitLossPercent,
    breakeven,
    maxProfit: round2(Math.max(...pnlPcts)),
    maxLoss:   round2(Math.min(...pnlPcts)),
    pnlCurve:  curve,
  };
}
