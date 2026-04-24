export type StrategyOutlook = 'bullish' | 'bearish' | 'neutral' | 'volatile' | 'bullish-neutral' | 'bearish-neutral';
export type StrategyTier = 'rookie' | 'veteran' | 'seasoned-veteran' | 'all-star';
export type IVPreference = 'high' | 'low' | 'neutral' | 'very-high' | 'very-low';
export type TimeDecayProfile = 'benefits' | 'hurts' | 'neutral' | 'mixed';
export type RiskProfile = 'defined' | 'undefined';

export interface StrategyDefinition {
  id: string;
  name: string;
  tier: StrategyTier;
  outlook: StrategyOutlook[];
  ivPreference: IVPreference;
  ivRankMin: number;
  ivRankMax: number;
  timeDecay: TimeDecayProfile;
  riskProfile: RiskProfile;
  legs: number;
  requiresStock: boolean;
  url: string;
  description: string;
  idealConditions: {
    rsiMin?: number;
    rsiMax?: number;
    trendRequired?: 'bullish' | 'bearish' | 'neutral' | 'any';
    minTechnicalScore?: number;
    minMomentumScore?: number;
    earningsPlayOnly?: boolean;
    highVolatilityEvent?: boolean;
  };
}

export const STRATEGY_REGISTRY: StrategyDefinition[] = [
  // ─── ROOKIES ───────────────────────────────────────────────────────────────
  {
    id: 'covered_call',
    name: 'Covered Call',
    tier: 'rookie',
    outlook: ['bullish-neutral'],
    ivPreference: 'high',
    ivRankMin: 40, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 1,
    requiresStock: true,
    url: 'https://www.optionsplaybook.com/option-strategies/covered-call',
    description: 'Sell a call against stock you already own to generate income.',
    idealConditions: { trendRequired: 'bullish', minTechnicalScore: 15 },
  },
  {
    id: 'protective_put',
    name: 'Protective Put',
    tier: 'rookie',
    outlook: ['bullish'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 40,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 1,
    requiresStock: true,
    url: 'https://www.optionsplaybook.com/option-strategies/protective-put',
    description: 'Buy a put to protect stock you own against a large drop.',
    idealConditions: { trendRequired: 'bullish' },
  },
  {
    id: 'collar',
    name: 'Collar',
    tier: 'rookie',
    outlook: ['bullish-neutral'],
    ivPreference: 'neutral',
    ivRankMin: 30, ivRankMax: 70,
    timeDecay: 'neutral',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: true,
    url: 'https://www.optionsplaybook.com/option-strategies/collar-option',
    description: 'Own stock, sell a call and buy a put to cap both upside and downside.',
    idealConditions: { trendRequired: 'bullish' },
  },
  {
    id: 'cash_secured_put',
    name: 'Cash-Secured Put',
    tier: 'rookie',
    outlook: ['bullish-neutral'],
    ivPreference: 'high',
    ivRankMin: 40, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 1,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/cash-secured-put',
    description: 'Sell a put with cash reserved, effectively getting paid to try to buy a stock at a discount.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 30, rsiMax: 50 },
  },

  // ─── VETERANS ──────────────────────────────────────────────────────────────
  {
    id: 'long_call',
    name: 'Long Call',
    tier: 'veteran',
    outlook: ['bullish'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 35,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 1,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-call',
    description: 'Buy a call to profit from a strong upward move with limited downside.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 50, rsiMax: 70, minTechnicalScore: 22 },
  },
  {
    id: 'long_put',
    name: 'Long Put',
    tier: 'veteran',
    outlook: ['bearish'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 35,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 1,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-put',
    description: 'Buy a put to profit from a significant decline with defined risk.',
    idealConditions: { trendRequired: 'bearish', rsiMin: 30, rsiMax: 50, minTechnicalScore: 20 },
  },
  {
    id: 'fig_leaf',
    name: 'Fig Leaf',
    tier: 'veteran',
    outlook: ['bullish'],
    ivPreference: 'neutral',
    ivRankMin: 20, ivRankMax: 60,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/leveraged-covered-call',
    description: 'Use a long-dated LEAPS call in place of stock, then sell near-term calls against it.',
    idealConditions: { trendRequired: 'bullish', minTechnicalScore: 18 },
  },
  {
    id: 'long_call_spread',
    name: 'Long Call Spread',
    tier: 'veteran',
    outlook: ['bullish'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 50,
    timeDecay: 'neutral',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-call-spread',
    description: 'Buy a call and sell a higher-strike call to reduce cost; profit if stock rises moderately.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 45, rsiMax: 65, minTechnicalScore: 18 },
  },
  {
    id: 'long_put_spread',
    name: 'Long Put Spread',
    tier: 'veteran',
    outlook: ['bearish'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 50,
    timeDecay: 'neutral',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-put-spread',
    description: 'Buy a put and sell a lower-strike put to reduce cost; profit if stock falls moderately.',
    idealConditions: { trendRequired: 'bearish', rsiMin: 35, rsiMax: 55, minTechnicalScore: 18 },
  },

  // ─── SEASONED VETERANS ──────────────────────────────────────────────────────
  {
    id: 'short_call_spread',
    name: 'Short Call Spread',
    tier: 'seasoned-veteran',
    outlook: ['bearish-neutral'],
    ivPreference: 'high',
    ivRankMin: 45, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/short-call-spread',
    description: 'Sell a call spread to collect premium when you expect the stock to stay below a level.',
    idealConditions: { trendRequired: 'bearish', minTechnicalScore: 15 },
  },
  {
    id: 'short_put_spread',
    name: 'Short Put Spread',
    tier: 'seasoned-veteran',
    outlook: ['bullish-neutral'],
    ivPreference: 'high',
    ivRankMin: 45, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/short-put-spread',
    description: 'Sell a put spread to collect premium when you expect the stock to stay above a level.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'long_straddle',
    name: 'Long Straddle',
    tier: 'seasoned-veteran',
    outlook: ['volatile'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 35,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-straddle',
    description: 'Buy both a call and a put at the same strike — profit from a big move in either direction.',
    idealConditions: { trendRequired: 'neutral', highVolatilityEvent: true, rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'long_strangle',
    name: 'Long Strangle',
    tier: 'seasoned-veteran',
    outlook: ['volatile'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 35,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-strangle',
    description: 'Buy an OTM call and OTM put — cheaper than a straddle but needs a bigger move.',
    idealConditions: { trendRequired: 'neutral', highVolatilityEvent: true, rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'back_spread_calls',
    name: 'Back Spread w/Calls',
    tier: 'seasoned-veteran',
    outlook: ['bullish', 'volatile'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 40,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 3,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/call-backspread',
    description: 'Sell one call, buy two higher-strike calls — profits from a sharp bullish explosion.',
    idealConditions: { trendRequired: 'bullish', minTechnicalScore: 20, rsiMin: 55 },
  },
  {
    id: 'back_spread_puts',
    name: 'Back Spread w/Puts',
    tier: 'seasoned-veteran',
    outlook: ['bearish', 'volatile'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 40,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 3,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/put-backspread',
    description: 'Sell one put, buy two lower-strike puts — profits from a sharp bearish collapse.',
    idealConditions: { trendRequired: 'bearish', minTechnicalScore: 20, rsiMax: 45 },
  },
  {
    id: 'long_calendar_calls',
    name: 'Long Calendar Spread w/Calls',
    tier: 'seasoned-veteran',
    outlook: ['bullish-neutral'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 40,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/calendar-call-spread',
    description: 'Sell a near-term call, buy a same-strike farther-out call — profit from time decay difference.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'long_calendar_puts',
    name: 'Long Calendar Spread w/Puts',
    tier: 'seasoned-veteran',
    outlook: ['bearish-neutral'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 40,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/calendar-put-spread',
    description: 'Sell a near-term put, buy a same-strike farther-out put — profit from time decay difference.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'diagonal_spread_calls',
    name: 'Diagonal Spread w/Calls',
    tier: 'seasoned-veteran',
    outlook: ['bullish-neutral'],
    ivPreference: 'neutral',
    ivRankMin: 25, ivRankMax: 65,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/diagonal-call-spread',
    description: 'Cross between a calendar and call spread — different strikes AND expirations.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 45, rsiMax: 65 },
  },
  {
    id: 'diagonal_spread_puts',
    name: 'Diagonal Spread w/Puts',
    tier: 'seasoned-veteran',
    outlook: ['bearish-neutral'],
    ivPreference: 'neutral',
    ivRankMin: 25, ivRankMax: 65,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/diagonal-put-spread',
    description: 'Cross between a calendar and put spread — different strikes AND expirations.',
    idealConditions: { trendRequired: 'bearish', rsiMin: 35, rsiMax: 55 },
  },
  {
    id: 'long_butterfly_calls',
    name: 'Long Butterfly w/Calls',
    tier: 'seasoned-veteran',
    outlook: ['neutral'],
    ivPreference: 'high',
    ivRankMin: 40, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 3,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-call-butterfly-spread',
    description: 'Buy a call spread and sell a higher call spread — max profit if stock pins near center strike.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'long_butterfly_puts',
    name: 'Long Butterfly w/Puts',
    tier: 'seasoned-veteran',
    outlook: ['neutral'],
    ivPreference: 'high',
    ivRankMin: 40, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 3,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-put-butterfly-spread',
    description: 'Put version of the butterfly — same payoff, structured with puts.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'iron_butterfly',
    name: 'Iron Butterfly',
    tier: 'seasoned-veteran',
    outlook: ['neutral'],
    ivPreference: 'very-high',
    ivRankMin: 60, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/iron-butterfly',
    description: 'Short straddle with protective wings — collect large credit if stock stays near the center.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'skip_strike_butterfly_calls',
    name: 'Skip Strike Butterfly w/Calls',
    tier: 'seasoned-veteran',
    outlook: ['bullish'],
    ivPreference: 'neutral',
    ivRankMin: 30, ivRankMax: 70,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/broken-wing-butterfly-call',
    description: 'A butterfly with an asymmetric wing — skips a strike to reduce cost with bullish bias.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 50, rsiMax: 70 },
  },
  {
    id: 'skip_strike_butterfly_puts',
    name: 'Skip Strike Butterfly w/Puts',
    tier: 'seasoned-veteran',
    outlook: ['bearish'],
    ivPreference: 'neutral',
    ivRankMin: 30, ivRankMax: 70,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/broken-wing-butterfly-put',
    description: 'Put butterfly with asymmetric wing — skips a strike to reduce cost with bearish bias.',
    idealConditions: { trendRequired: 'bearish', rsiMin: 30, rsiMax: 50 },
  },
  {
    id: 'inverse_skip_strike_butterfly_calls',
    name: 'Inverse Skip Strike Butterfly w/Calls',
    tier: 'seasoned-veteran',
    outlook: ['volatile', 'bullish'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 40,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/inverse-broken-wing-butterfly-call',
    description: 'Back spread with calls modified — benefits from a big move, especially bullish.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 55 },
  },
  {
    id: 'inverse_skip_strike_butterfly_puts',
    name: 'Inverse Skip Strike Butterfly w/Puts',
    tier: 'seasoned-veteran',
    outlook: ['volatile', 'bearish'],
    ivPreference: 'low',
    ivRankMin: 0, ivRankMax: 40,
    timeDecay: 'hurts',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/inverse-broken-wing-butterfly-put',
    description: 'Back spread with puts modified — benefits from a big move, especially bearish.',
    idealConditions: { trendRequired: 'bearish', rsiMax: 45 },
  },
  {
    id: 'christmas_tree_butterfly_calls',
    name: 'Christmas Tree Butterfly w/Calls',
    tier: 'seasoned-veteran',
    outlook: ['bullish'],
    ivPreference: 'high',
    ivRankMin: 45, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/christmas-tree-butterfly-call',
    description: 'Skewed call butterfly — designed for a moderate bullish move with low cost.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 50, rsiMax: 70 },
  },
  {
    id: 'christmas_tree_butterfly_puts',
    name: 'Christmas Tree Butterfly w/Puts',
    tier: 'seasoned-veteran',
    outlook: ['bearish'],
    ivPreference: 'high',
    ivRankMin: 45, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/christmas-tree-butterfly-put',
    description: 'Skewed put butterfly — designed for a moderate bearish move with low cost.',
    idealConditions: { trendRequired: 'bearish', rsiMin: 30, rsiMax: 50 },
  },
  {
    id: 'long_condor_calls',
    name: 'Long Condor Spread w/Calls',
    tier: 'seasoned-veteran',
    outlook: ['neutral'],
    ivPreference: 'high',
    ivRankMin: 50, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-call-condor-spread',
    description: 'Wider than a butterfly — profit zone is a range, not a single price.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'long_condor_puts',
    name: 'Long Condor Spread w/Puts',
    tier: 'seasoned-veteran',
    outlook: ['neutral'],
    ivPreference: 'high',
    ivRankMin: 50, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/long-put-condor-spread',
    description: 'Put version of the condor — same neutral profit zone, built with puts.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'iron_condor',
    name: 'Iron Condor',
    tier: 'seasoned-veteran',
    outlook: ['neutral'],
    ivPreference: 'very-high',
    ivRankMin: 50, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/iron-condor',
    description: 'Sell an OTM call spread AND an OTM put spread — profit if stock stays range-bound.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },

  // ─── ALL-STARS ──────────────────────────────────────────────────────────────
  {
    id: 'short_call',
    name: 'Short Call',
    tier: 'all-star',
    outlook: ['bearish-neutral'],
    ivPreference: 'very-high',
    ivRankMin: 65, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'undefined',
    legs: 1,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/short-call',
    description: 'Naked short call — collect premium betting the stock stays below the strike. Unlimited risk.',
    idealConditions: { trendRequired: 'bearish', rsiMax: 50 },
  },
  {
    id: 'short_put',
    name: 'Short Put',
    tier: 'all-star',
    outlook: ['bullish-neutral'],
    ivPreference: 'very-high',
    ivRankMin: 65, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'undefined',
    legs: 1,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/short-put',
    description: 'Naked short put — collect premium betting the stock stays above the strike.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 45 },
  },
  {
    id: 'short_straddle',
    name: 'Short Straddle',
    tier: 'all-star',
    outlook: ['neutral'],
    ivPreference: 'very-high',
    ivRankMin: 70, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'undefined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/short-straddle',
    description: 'Sell both a call and put at the same strike — max profit if stock pins at expiration.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'short_strangle',
    name: 'Short Strangle',
    tier: 'all-star',
    outlook: ['neutral'],
    ivPreference: 'very-high',
    ivRankMin: 65, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'undefined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/short-strangle',
    description: 'Sell an OTM call and OTM put — wider profit zone than a straddle, still undefined risk.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
  {
    id: 'long_combination',
    name: 'Long Combination',
    tier: 'all-star',
    outlook: ['bullish'],
    ivPreference: 'neutral',
    ivRankMin: 20, ivRankMax: 80,
    timeDecay: 'neutral',
    riskProfile: 'undefined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/synthetic-long-stock',
    description: 'Synthetic long stock — buy a call and sell a put at the same strike.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 50, minTechnicalScore: 22 },
  },
  {
    id: 'short_combination',
    name: 'Short Combination',
    tier: 'all-star',
    outlook: ['bearish'],
    ivPreference: 'neutral',
    ivRankMin: 20, ivRankMax: 80,
    timeDecay: 'neutral',
    riskProfile: 'undefined',
    legs: 2,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/synthetic-short-stock',
    description: 'Synthetic short stock — buy a put and sell a call at the same strike.',
    idealConditions: { trendRequired: 'bearish', rsiMax: 50, minTechnicalScore: 22 },
  },
  {
    id: 'front_spread_calls',
    name: 'Front Spread w/Calls',
    tier: 'all-star',
    outlook: ['bullish-neutral'],
    ivPreference: 'very-high',
    ivRankMin: 60, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'undefined',
    legs: 3,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/call-ratio-vertical-spread',
    description: 'Buy one call, sell two higher-strike calls — profit if stock rises to sold strike.',
    idealConditions: { trendRequired: 'bullish', rsiMin: 45, rsiMax: 65 },
  },
  {
    id: 'front_spread_puts',
    name: 'Front Spread w/Puts',
    tier: 'all-star',
    outlook: ['bearish-neutral'],
    ivPreference: 'very-high',
    ivRankMin: 60, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'undefined',
    legs: 3,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/put-ratio-vertical-spread',
    description: 'Buy one put, sell two lower-strike puts — profit if stock falls to sold strike.',
    idealConditions: { trendRequired: 'bearish', rsiMin: 35, rsiMax: 55 },
  },
  {
    id: 'double_diagonal',
    name: 'Double Diagonal',
    tier: 'all-star',
    outlook: ['neutral'],
    ivPreference: 'high',
    ivRankMin: 50, ivRankMax: 100,
    timeDecay: 'benefits',
    riskProfile: 'defined',
    legs: 4,
    requiresStock: false,
    url: 'https://www.optionsplaybook.com/option-strategies/double-diagonal-spread',
    description: 'Run a diagonal call spread and diagonal put spread simultaneously — income from time decay.',
    idealConditions: { trendRequired: 'neutral', rsiMin: 40, rsiMax: 60 },
  },
];

export function getStrategiesForConditions(params: {
  outlook: 'bullish' | 'bearish' | 'neutral';
  ivRank: number;
  rsi14: number;
  technicalScore: number;
  momentumScore: number;
  hasEarnings?: boolean;
  maxTier?: StrategyTier;
  enabledStrategyIds?: Record<string, boolean>;
  preferredIvEnvironment?: 'high' | 'low' | 'any';
  ivRankLowThreshold?: number;
  ivRankHighThreshold?: number;
  strategyAutoSelectByIv?: boolean;
}): Array<StrategyDefinition & { fitScore: number; fitReason: string }> {
  const {
    outlook,
    ivRank,
    rsi14,
    technicalScore,
    momentumScore,
    hasEarnings = false,
    enabledStrategyIds = {},
    preferredIvEnvironment = 'any',
    ivRankLowThreshold = 30,
    ivRankHighThreshold = 60,
    strategyAutoSelectByIv = true,
  } = params;

  const outlookMap: Record<string, StrategyOutlook[]> = {
    bullish: ['bullish', 'bullish-neutral', 'volatile'],
    bearish: ['bearish', 'bearish-neutral', 'volatile'],
    neutral: ['neutral', 'bullish-neutral', 'bearish-neutral'],
  };
  const acceptableOutlooks = outlookMap[outlook] ?? [];

  const tierOrder: StrategyTier[] = ['rookie', 'veteran', 'seasoned-veteran', 'all-star'];
  const maxTierIndex = params.maxTier ? tierOrder.indexOf(params.maxTier) : tierOrder.length - 1;

  const results = STRATEGY_REGISTRY
    .filter(s => {
      if (enabledStrategyIds[s.id] === false) return false;
      if (tierOrder.indexOf(s.tier) > maxTierIndex) return false;
      return s.outlook.some(o => acceptableOutlooks.includes(o));
    })
    .map(s => {
      let fitScore = 0;
      const reasons: string[] = [];

      // IV rank fit (0-40 points)
      if (ivRank >= s.ivRankMin && ivRank <= s.ivRankMax) {
        fitScore += 40;
        reasons.push(`IV rank ${ivRank} fits ideal range (${s.ivRankMin}–${s.ivRankMax})`);
      } else {
        const distance = Math.min(
          Math.abs(ivRank - s.ivRankMin),
          Math.abs(ivRank - s.ivRankMax)
        );
        fitScore += Math.max(0, 40 - distance * 1.5);
      }

      if (strategyAutoSelectByIv) {
        const environment = ivRank >= ivRankHighThreshold ? 'high' : ivRank <= ivRankLowThreshold ? 'low' : 'neutral';
        const likesHighIv = s.ivPreference === 'high' || s.ivPreference === 'very-high';
        const likesLowIv = s.ivPreference === 'low' || s.ivPreference === 'very-low';
        const likesNeutralIv = s.ivPreference === 'neutral';
        if ((environment === 'high' && likesHighIv) || (environment === 'low' && likesLowIv) || (environment === 'neutral' && likesNeutralIv)) {
          fitScore += 8;
          reasons.push(`${environment.toUpperCase()} IV environment aligns`);
        } else {
          fitScore -= 8;
        }
      }

      if (preferredIvEnvironment !== 'any') {
        const prefersHigh = s.ivPreference === 'high' || s.ivPreference === 'very-high';
        const prefersLow = s.ivPreference === 'low' || s.ivPreference === 'very-low';
        if ((preferredIvEnvironment === 'high' && prefersHigh) || (preferredIvEnvironment === 'low' && prefersLow)) {
          fitScore += 6;
          reasons.push(`${preferredIvEnvironment.toUpperCase()} IV preference matches`);
        } else {
          fitScore -= 6;
        }
      }

      // RSI fit (0-20 points)
      const rsiMin = s.idealConditions.rsiMin ?? 0;
      const rsiMax = s.idealConditions.rsiMax ?? 100;
      if (rsi14 >= rsiMin && rsi14 <= rsiMax) {
        fitScore += 20;
        reasons.push(`RSI ${rsi14.toFixed(0)} in ideal range`);
      } else {
        const rsiDist = Math.min(Math.abs(rsi14 - rsiMin), Math.abs(rsi14 - rsiMax));
        fitScore += Math.max(0, 20 - rsiDist);
      }

      // Technical strength fit (0-20 points)
      const minTech = s.idealConditions.minTechnicalScore ?? 0;
      if (technicalScore >= minTech) {
        fitScore += 20;
        reasons.push('Technical signals aligned');
      } else {
        fitScore += Math.max(0, 20 - (minTech - technicalScore) * 2);
      }

      // Momentum fit (0-10 points)
      const minMom = s.idealConditions.minMomentumScore ?? 0;
      if (momentumScore >= minMom) {
        fitScore += 10;
      }

      // Earnings bonus for vol strategies (0-10 points)
      if (hasEarnings && s.idealConditions.highVolatilityEvent) {
        fitScore += 10;
        reasons.push('Earnings catalyst aligns');
      }

      const fitReason = reasons.length > 0 ? reasons.join(' · ') : 'Conditions partially match';

      return { ...s, fitScore: Math.round(fitScore), fitReason };
    })
    .sort((a, b) => b.fitScore - a.fitScore);

  return results;
}
