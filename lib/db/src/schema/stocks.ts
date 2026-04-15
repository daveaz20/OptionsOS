import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stocksTable = pgTable("stocks", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  price: real("price").notNull(),
  change: real("change").notNull().default(0),
  changePercent: real("change_percent").notNull().default(0),
  volume: real("volume").notNull().default(0),
  marketCap: real("market_cap").notNull().default(0),
  sector: text("sector").notNull().default("Technology"),
  technicalStrength: integer("technical_strength").notNull().default(5),
  fiftyTwoWeekHigh: real("fifty_two_week_high").notNull().default(0),
  fiftyTwoWeekLow: real("fifty_two_week_low").notNull().default(0),
  eps: real("eps").notNull().default(0),
  pe: real("pe").notNull().default(0),
  dividendYield: real("dividend_yield").notNull().default(0),
  ivRank: real("iv_rank").notNull().default(0),
  relativeStrength: text("relative_strength").notNull().default("5/10"),
  supportPrice: real("support_price").notNull().default(0),
  resistancePrice: real("resistance_price").notNull().default(0),
  earningsDate: text("earnings_date").notNull().default("TBD"),
  liquidity: text("liquidity").notNull().default("Liquid"),
  priceAction: text("price_action").notNull().default("Neutral trend"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStockSchema = createInsertSchema(stocksTable).omit({ id: true, createdAt: true });
export type InsertStock = z.infer<typeof insertStockSchema>;
export type Stock = typeof stocksTable.$inferSelect;
