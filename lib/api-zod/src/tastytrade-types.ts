import * as zod from "zod";

// ─── Options Chain ────────────────────────────────────────────────────────

export const OptionContractSchema = zod.object({
  symbol: zod.string(),
  optionType: zod.enum(["call", "put"]),
  strikePrice: zod.number(),
  expiration: zod.string(),
  daysToExpiration: zod.number(),
  bid: zod.number(),
  ask: zod.number(),
  mid: zod.number(),
  impliedVolatility: zod.number(),
  delta: zod.number(),
  gamma: zod.number(),
  theta: zod.number(),
  vega: zod.number(),
  openInterest: zod.number(),
  volume: zod.number(),
});
export type OptionContract = zod.infer<typeof OptionContractSchema>;

export const OptionsChainExpirySchema = zod.object({
  expiration: zod.string(),
  daysToExpiration: zod.number(),
  settlementType: zod.string(),
  contracts: zod.array(OptionContractSchema),
});
export type OptionsChainExpiry = zod.infer<typeof OptionsChainExpirySchema>;

export const OptionsChainSchema = zod.object({
  underlying: zod.string(),
  expirations: zod.array(OptionsChainExpirySchema),
});
export type OptionsChain = zod.infer<typeof OptionsChainSchema>;

// ─── Account Balances ─────────────────────────────────────────────────────

export const AccountBalancesSchema = zod.object({
  netLiquidatingValue: zod.number(),
  optionBuyingPower: zod.number(),
  cashBalance: zod.number(),
  dayPnl: zod.number(),
  realizedDayGain: zod.number(),
  unrealizedDayGain: zod.number(),
});
export type AccountBalances = zod.infer<typeof AccountBalancesSchema>;

// ─── Account Positions ────────────────────────────────────────────────────

export const PositionLegSchema = zod.object({
  symbol: zod.string(),
  optionType: zod.enum(["call", "put"]),
  action: zod.enum(["long", "short"]),
  strikePrice: zod.number(),
  quantity: zod.number(),
  openPrice: zod.number(),
  currentPrice: zod.number(),
  pnl: zod.number(),
});
export type PositionLeg = zod.infer<typeof PositionLegSchema>;

export const PositionGreeksSchema = zod.object({
  delta: zod.number(),
  gamma: zod.number(),
  theta: zod.number(),
  vega: zod.number(),
});

export const AccountPositionSchema = zod.object({
  id: zod.string(),
  underlying: zod.string(),
  strategyType: zod.string(),
  expiration: zod.string(),
  dte: zod.number(),
  strikesLabel: zod.string(),
  legs: zod.array(PositionLegSchema),
  totalPnl: zod.number(),
  totalPnlPercent: zod.number(),
  greeks: PositionGreeksSchema,
});
export type AccountPosition = zod.infer<typeof AccountPositionSchema>;

export const AccountPositionsResponseSchema = zod.object({
  positions: zod.array(AccountPositionSchema),
});
export type AccountPositionsResponse = zod.infer<typeof AccountPositionsResponseSchema>;

// ─── Account Summary ──────────────────────────────────────────────────────

export const AccountSummarySchema = zod.object({
  netLiquidatingValue: zod.number(),
  optionBuyingPower: zod.number(),
  dayPnl: zod.number(),
  openPositionsCount: zod.number(),
  portfolioTheta: zod.number(),
});
export type AccountSummary = zod.infer<typeof AccountSummarySchema>;
