import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const userSettingsTable = pgTable("user_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserSettingsRow = typeof userSettingsTable.$inferSelect;
