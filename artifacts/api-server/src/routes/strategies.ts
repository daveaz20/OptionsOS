import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, stocksTable } from "@workspace/db";
import {
  GetStrategiesParams,
  GetStrategiesQueryParams,
  GetStrategiesResponse,
  CalculatePnlParams,
  CalculatePnlBody,
  CalculatePnlResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stocks/:symbol/strategies", async (req, res): Promise<void> => {
  const params = GetStrategiesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetStrategiesQueryParams.safeParse(req.query);
  const outlook = query.success ? query.data.outlook : "bullish";

  const symbol = Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol;

  const [stock] = await db
    .select()
    .from(stocksTable)
    .where(sql`${stocksTable.symbol} = ${symbol.toUpperCase()}`);

  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const strategies = generateStrategies(stock, outlook ?? "bullish");
  res.json(GetStrategiesResponse.parse(strategies));
});

router.post("/stocks/:symbol/pnl", async (req, res): Promise<void> => {
  const params = CalculatePnlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CalculatePnlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const symbol = Array.isArray(params.data.symbol) ? params.data.symbol[0] : params.data.symbol;

  const [stock] = await db
    .select()
    .from(stocksTable)
    .where(sql`${stocksTable.symbol} = ${symbol.toUpperCase()}`);

  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const { targetPrice, strategyId } = parsed.data;
  const diff = targetPrice - stock.price;
  const profitLoss = Math.round(diff * 100) / 100;
  const profitLossPercent = Math.round((diff / stock.price) * 10000) / 100;

  const pnlCurve = [];
  const minPrice = stock.price * 0.7;
  const maxPrice = stock.price * 1.3;
  const step = (maxPrice - minPrice) / 50;

  for (let p = minPrice; p <= maxPrice; p += step) {
    const pnl = calculateStrategyPnl(p, stock.price, strategyId);
    pnlCurve.push({
      price: Math.round(p * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
    });
  }

  const pnls = pnlCurve.map((p) => p.pnl);

  const result = {
    profitLoss,
    profitLossPercent,
    breakeven: Math.round(stock.price * 100) / 100,
    maxProfit: Math.round(Math.max(...pnls) * 100) / 100,
    maxLoss: Math.round(Math.min(...pnls) * 100) / 100,
    pnlCurve,
  };

  res.json(CalculatePnlResponse.parse(result));
});

function calculateStrategyPnl(targetPrice: number, currentPrice: number, strategyId: number): number {
  const diff = targetPrice - currentPrice;
  switch (strategyId % 3) {
    case 0:
      return diff * 100;
    case 1:
      return Math.max(diff * 100, -currentPrice * 0.05 * 100);
    case 2:
      return Math.min(Math.max(diff * 50, -currentPrice * 0.03 * 100), currentPrice * 0.08 * 100);
    default:
      return diff * 100;
  }
}

function generateStrategies(stock: { price: number; symbol: string; technicalStrength: number }, outlook: string) {
  const price = stock.price;
  const expDate = new Date();
  expDate.setMonth(expDate.getMonth() + 2);
  const expDateStr = expDate.toISOString().split("T")[0];

  const strategies = [];

  if (outlook === "bullish" || outlook === "neutral") {
    strategies.push({
      id: 1,
      name: `Buy 100 Shares`,
      type: "trade" as const,
      outlook: outlook as "bullish" | "bearish" | "neutral",
      description: `Buy 100 shares of ${stock.symbol} at market price`,
      legs: [{
        action: "buy" as const,
        optionType: "call" as const,
        strikePrice: price,
        premium: 0,
        quantity: 100,
        expiration: expDateStr,
      }],
      tradeCost: Math.round(-price * 100 * 100) / 100,
      maxProfit: Math.round(price * 0.2 * 100 * 100) / 100,
      maxLoss: Math.round(-price * 100 * 100) / 100,
      returnPercent: Math.round(20 * 100) / 100,
      breakeven: price,
      score: Math.min(Math.round(stock.technicalStrength * 12 + Math.random() * 20), 200),
      expirationDate: expDateStr,
    });
  }

  const putStrike = Math.round(price * 0.95 * 100) / 100;
  const putPremium = Math.round(price * 0.03 * 100) / 100;
  strategies.push({
    id: 2,
    name: `Buy ${expDateStr.slice(5)} ${putStrike} Put`,
    type: "trade" as const,
    outlook: "bearish" as const,
    description: `Buy a put option on ${stock.symbol} with strike at $${putStrike}`,
    legs: [{
      action: "buy" as const,
      optionType: "put" as const,
      strikePrice: putStrike,
      premium: putPremium,
      quantity: 1,
      expiration: expDateStr,
    }],
    tradeCost: Math.round(-putPremium * 100 * 100) / 100,
    maxProfit: Math.round(putStrike * 100 * 100) / 100,
    maxLoss: Math.round(-putPremium * 100 * 100) / 100,
    returnPercent: Math.round((putStrike / putPremium) * 100) / 100,
    breakeven: Math.round((putStrike - putPremium) * 100) / 100,
    score: Math.min(Math.round(stock.technicalStrength * 10 + Math.random() * 30), 200),
    expirationDate: expDateStr,
  });

  const spreadLow = Math.round(price * 0.97 * 100) / 100;
  const spreadHigh = Math.round(price * 1.03 * 100) / 100;
  const spreadPremium = Math.round(price * 0.02 * 100) / 100;
  strategies.push({
    id: 3,
    name: `${expDateStr.slice(5)} ${spreadLow}/${spreadHigh} Put Vertical`,
    type: "trade" as const,
    outlook: outlook === "bearish" ? "bearish" as const : "bullish" as const,
    description: `Vertical spread on ${stock.symbol} between $${spreadLow} and $${spreadHigh}`,
    legs: [
      {
        action: "buy" as const,
        optionType: "put" as const,
        strikePrice: spreadHigh,
        premium: spreadPremium * 1.5,
        quantity: 1,
        expiration: expDateStr,
      },
      {
        action: "sell" as const,
        optionType: "put" as const,
        strikePrice: spreadLow,
        premium: spreadPremium,
        quantity: 1,
        expiration: expDateStr,
      },
    ],
    tradeCost: Math.round(-spreadPremium * 0.5 * 100 * 100) / 100,
    maxProfit: Math.round((spreadHigh - spreadLow - spreadPremium * 0.5) * 100 * 100) / 100,
    maxLoss: Math.round(-spreadPremium * 0.5 * 100 * 100) / 100,
    returnPercent: Math.round(((spreadHigh - spreadLow) / (spreadPremium * 0.5)) * 100 * 100) / 100,
    breakeven: Math.round((spreadHigh - spreadPremium * 0.5) * 100) / 100,
    score: Math.min(Math.round(stock.technicalStrength * 14 + Math.random() * 15), 200),
    expirationDate: expDateStr,
  });

  return strategies;
}

export default router;
