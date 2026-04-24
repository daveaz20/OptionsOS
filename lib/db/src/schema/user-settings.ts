import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

export const userSettingsTable = pgTable("user_settings", {
  id: integer("id").primaryKey(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserSettingsRow = typeof userSettingsTable.$inferSelect;
