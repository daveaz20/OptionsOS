import * as zod from "zod";

export const StreamedGreeksSchema = zod.object({
  symbol: zod.string(),
  delta: zod.number(),
  gamma: zod.number(),
  theta: zod.number(),
  vega: zod.number(),
  rho: zod.number(),
  iv: zod.number(),
});
export type StreamedGreeks = zod.infer<typeof StreamedGreeksSchema>;

export const StreamedQuoteSchema = zod.object({
  symbol: zod.string(),
  bid: zod.number(),
  ask: zod.number(),
  last: zod.number(),
  mark: zod.number(),
  volume: zod.number(),
  bidSize: zod.number().optional(),
  askSize: zod.number().optional(),
  dayHigh: zod.number().optional(),
  dayLow: zod.number().optional(),
  previousClose: zod.number().optional(),
});
export type StreamedQuote = zod.infer<typeof StreamedQuoteSchema>;

export const TastytradeQuoteSchema = zod.object({
  symbol: zod.string(),
  bid: zod.number(),
  ask: zod.number(),
  last: zod.number(),
  mark: zod.number(),
  volume: zod.number(),
  source: zod.string(),
});
export type TastytradeQuote = zod.infer<typeof TastytradeQuoteSchema>;

export const TastytradeGreekSchema = zod.object({
  symbol: zod.string(),
  delta: zod.number(),
  gamma: zod.number(),
  theta: zod.number(),
  vega: zod.number(),
  rho: zod.number(),
  iv: zod.number(),
  source: zod.string(),
});
export type TastytradeGreek = zod.infer<typeof TastytradeGreekSchema>;

export const StreamerStatusSchema = zod.object({
  connected: zod.boolean(),
  subscribedSymbols: zod.number(),
  subscribedOptions: zod.number(),
});
export type StreamerStatus = zod.infer<typeof StreamerStatusSchema>;

export const TastytradeAuthStatusSchema = zod.object({
  enabled: zod.boolean(),
  connected: zod.boolean(),
  expiresAt: zod.number().nullable().optional(),
});
export type TastytradeAuthStatus = zod.infer<typeof TastytradeAuthStatusSchema>;

export const NetLiqHistoryPointSchema = zod.object({
  time: zod.string(),
  close: zod.number(),
});
export type NetLiqHistoryPoint = zod.infer<typeof NetLiqHistoryPointSchema>;

export const TransactionSchema = zod.object({
  id: zod.string(),
  symbol: zod.string(),
  action: zod.string(),
  quantity: zod.number(),
  price: zod.number(),
  executedAt: zod.string(),
  description: zod.string(),
});
export type TastytradeTransaction = zod.infer<typeof TransactionSchema>;

export const MarginRequirementLegSchema = zod.object({
  instrument_type: zod.string(),
  symbol: zod.string(),
  quantity: zod.number(),
  action: zod.string(),
});
export type MarginRequirementLeg = zod.infer<typeof MarginRequirementLegSchema>;

export const MarginRequirementRequestSchema = zod.object({
  symbol: zod.string(),
  legs: zod.array(MarginRequirementLegSchema),
});
export type MarginRequirementRequest = zod.infer<typeof MarginRequirementRequestSchema>;

export const MarginRequirementResponseSchema = zod.object({
  buyingPowerEffect: zod.number(),
  isolatedOrderMarginRequirement: zod.number(),
  costEffect: zod.number(),
  changeInMarginRequirement: zod.number(),
  raw: zod.unknown(),
});
export type MarginRequirementResponse = zod.infer<typeof MarginRequirementResponseSchema>;

export const OptionContractSchema = zod.object({
  symbol: zod.string(),
  streamerSymbol: zod.string().nullable().optional(),
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
  rho: zod.number().optional(),
  openInterest: zod.number(),
  volume: zod.number(),
  greeksSource: zod.enum(["live", "rest", "none"]),
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

export const AccountBalancesSchema = zod.object({
  netLiquidatingValue: zod.number(),
  optionBuyingPower: zod.number(),
  cashBalance: zod.number(),
  dayPnl: zod.number(),
  realizedDayGain: zod.number(),
  unrealizedDayGain: zod.number(),
});
export type AccountBalances = zod.infer<typeof AccountBalancesSchema>;

export const PositionLegSchema = zod.object({
  symbol: zod.string(),
  streamerSymbol: zod.string().nullable().optional(),
  optionType: zod.enum(["call", "put"]),
  action: zod.enum(["long", "short"]),
  strikePrice: zod.number(),
  quantity: zod.number(),
  openPrice: zod.number(),
  currentPrice: zod.number(),
  livePrice: zod.number().nullable().optional(),
  liveGreeks: StreamedGreeksSchema.nullable().optional(),
  unrealizedPnl: zod.number().nullable().optional(),
  pnl: zod.number(),
});
export type PositionLeg = zod.infer<typeof PositionLegSchema>;

export const PositionGreeksSchema = zod.object({
  delta: zod.number(),
  gamma: zod.number(),
  theta: zod.number(),
  vega: zod.number(),
});
export type PositionGreeks = zod.infer<typeof PositionGreeksSchema>;

export const LivePositionGreeksSchema = zod.object({
  delta: zod.number(),
  gamma: zod.number(),
  theta: zod.number(),
  vega: zod.number(),
  rho: zod.number(),
  iv: zod.number(),
});
export type LivePositionGreeks = zod.infer<typeof LivePositionGreeksSchema>;

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
  livePrice: zod.number().nullable().optional(),
  liveGreeks: LivePositionGreeksSchema.nullable().optional(),
  unrealizedPnl: zod.number().nullable().optional(),
  greeks: PositionGreeksSchema,
});
export type AccountPosition = zod.infer<typeof AccountPositionSchema>;

export const AccountPositionsResponseSchema = zod.object({
  positions: zod.array(AccountPositionSchema),
});
export type AccountPositionsResponse = zod.infer<typeof AccountPositionsResponseSchema>;

export const AccountSummarySchema = zod.object({
  netLiquidatingValue: zod.number(),
  optionBuyingPower: zod.number(),
  dayPnl: zod.number(),
  openPositionsCount: zod.number(),
  portfolioTheta: zod.number(),
});
export type AccountSummary = zod.infer<typeof AccountSummarySchema>;
