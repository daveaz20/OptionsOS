import { pgTable, serial, jsonb, text, timestamp } from "drizzle-orm/pg-core";

export const screenerCacheTable = pgTable("screener_cache", {
  id:       serial("id").primaryKey(),
  payload:  jsonb("payload").$type<unknown[]>().notNull(),
  source:   text("source").notNull().default("yahoo"),
  cachedAt: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScreenerCacheRow = typeof screenerCacheTable.$inferSelect;
