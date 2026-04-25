import { Router, type IRouter } from "express";
import { db, screenerCacheTable, userSettingsTable, watchlistTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { isPolygonEnabled } from "../lib/polygon.js";
import { getServerEnv, maskSecret, updateServerEnv, type ServerEnvPatch } from "../lib/server-env.js";
import { getTastytradeTokenExpiry, isTastytradeAuthorized, isTastytradeEnabled } from "../lib/tastytrade.js";
import { getScreenerCacheInfo } from "./screener.js";

const router: IRouter = Router();

type SettingsRecord = Record<string, unknown>;
const serverStartedAt = Date.now();

function rowsToSettings(rows: Array<{ key: string; value: unknown }>): SettingsRecord {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function appVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    return String(JSON.parse(raw).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

async function rowCount(table: typeof userSettingsTable | typeof watchlistTable | typeof screenerCacheTable): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
  return Number(row?.count ?? 0);
}

async function polygonStatus(): Promise<"connected" | "disconnected" | "error" | "rate_limited"> {
  const env = getServerEnv();
  if (!isPolygonEnabled() || !env.POLYGON_API_KEY) return "disconnected";
  try {
    const response = await fetch(`https://api.polygon.io/v1/marketstatus/now?apiKey=${encodeURIComponent(env.POLYGON_API_KEY)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 429) return "rate_limited";
    return response.ok ? "connected" : "error";
  } catch {
    return "error";
  }
}

function tastytradeStatus(): "connected" | "disconnected" | "token_expired" {
  if (!isTastytradeEnabled() || !isTastytradeAuthorized()) return "disconnected";
  const expiresAt = getTastytradeTokenExpiry();
  if (expiresAt && expiresAt <= Date.now()) return "token_expired";
  return "connected";
}

function serverEnvPayload() {
  const env = getServerEnv();
  return {
    polygonApiKey: {
      configured: Boolean(env.POLYGON_API_KEY),
      masked: maskSecret(env.POLYGON_API_KEY),
    },
    tastytrade: {
      status: isTastytradeEnabled()
        ? isTastytradeAuthorized()
          ? "connected"
          : "disconnected"
        : "disconnected",
      username: env.TASTYTRADE_USERNAME,
      accountNumber: {
        configured: Boolean(env.TASTYTRADE_ACCOUNT_NUMBER),
        masked: maskSecret(env.TASTYTRADE_ACCOUNT_NUMBER),
      },
      clientId: {
        configured: Boolean(env.TASTYTRADE_CLIENT_ID),
        masked: maskSecret(env.TASTYTRADE_CLIENT_ID),
      },
      clientSecret: {
        configured: Boolean(env.TASTYTRADE_CLIENT_SECRET),
        masked: maskSecret(env.TASTYTRADE_CLIENT_SECRET),
      },
      redirectUri: env.TASTYTRADE_REDIRECT_URI,
      refreshToken: {
        configured: Boolean(env.TASTYTRADE_REFRESH_TOKEN),
        masked: maskSecret(env.TASTYTRADE_REFRESH_TOKEN),
      },
      tokenExpiresAt: getTastytradeTokenExpiry(),
    },
  };
}

router.get("/settings", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(userSettingsTable);
    res.json(rowsToSettings(rows));
  } catch (err) {
    res.status(500).json({ error: `Failed to load settings: ${(err as Error).message}` });
  }
});

router.patch("/settings", async (req, res): Promise<void> => {
  const incoming = req.body as SettingsRecord;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    res.status(400).json({ error: "Body must be a JSON object" });
    return;
  }

  try {
    const entries = Object.entries(incoming);

    if (entries.length > 0) {
      await db
        .insert(userSettingsTable)
        .values(entries.map(([key, value]) => ({ key, value, updatedAt: new Date() })))
        .onConflictDoUpdate({
          target: userSettingsTable.key,
          set: {
            value: sql`excluded.value`,
            updatedAt: new Date(),
          },
        });
    }

    const rows = await db.select().from(userSettingsTable);
    res.json(rowsToSettings(rows));
  } catch (err) {
    res.status(500).json({ error: `Failed to save settings: ${(err as Error).message}` });
  }
});

router.delete("/settings", async (_req, res): Promise<void> => {
  try {
    await db.delete(userSettingsTable);
    res.json({});
  } catch (err) {
    res.status(500).json({ error: `Failed to reset settings: ${(err as Error).message}` });
  }
});

router.get("/settings/status", async (_req, res): Promise<void> => {
  const dbStarted = Date.now();
  try {
    const [settingsRows, watchlistCount, screenerRows, polygon] = await Promise.all([
      db.select().from(userSettingsTable),
      rowCount(watchlistTable),
      db.select().from(screenerCacheTable),
      polygonStatus(),
      db.execute(sql`select 1`),
    ]);
    const screener = getScreenerCacheInfo();
    const screenerPayloadBytes = screenerRows.reduce((sum, row) => sum + jsonByteLength(row.payload), 0);
    res.json({
      database: {
        status: "connected",
        latencyMs: Date.now() - dbStarted,
      },
      polygon: { status: polygon },
      tastytrade: {
        status: tastytradeStatus(),
        tokenExpiresAt: getTastytradeTokenExpiry(),
      },
      serverUptimeMs: Date.now() - serverStartedAt,
      lastScreenerRefresh: screener.cachedAt > 0 ? new Date(screener.cachedAt).toISOString() : null,
      appVersion: appVersion(),
      nodeVersion: process.version,
      storage: {
        screenerCacheSize: screener.count,
        screenerCacheBytes: screenerPayloadBytes,
        watchlistSize: watchlistCount,
        settingsSize: settingsRows.length,
        settingsBytes: jsonByteLength(rowsToSettings(settingsRows)),
      },
    });
  } catch (err) {
    res.status(500).json({
      database: { status: "error", error: (err as Error).message },
      polygon: { status: "error" },
      tastytrade: { status: tastytradeStatus(), tokenExpiresAt: getTastytradeTokenExpiry() },
      serverUptimeMs: Date.now() - serverStartedAt,
      lastScreenerRefresh: null,
      appVersion: appVersion(),
      nodeVersion: process.version,
      storage: { screenerCacheSize: 0, screenerCacheBytes: 0, watchlistSize: 0, settingsSize: 0, settingsBytes: 0 },
    });
  }
});

router.post("/settings/export", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(userSettingsTable);
    const exportedAt = new Date().toISOString();
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="optionsos-settings-${exportedAt.replace(/[:.]/g, "-")}.json"`);
    res.send(JSON.stringify({ exportedAt, settings: rowsToSettings(rows) }, null, 2));
  } catch (err) {
    res.status(500).json({ error: `Failed to export settings: ${(err as Error).message}` });
  }
});

router.post("/settings/import", async (req, res): Promise<void> => {
  const body = req.body as unknown;
  const incoming =
    body && typeof body === "object" && !Array.isArray(body) && "settings" in body
      ? (body as { settings: unknown }).settings
      : body;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    res.status(400).json({ error: "Import must be a JSON object or an object with a settings property" });
    return;
  }

  try {
    const entries = Object.entries(incoming as SettingsRecord);
    if (entries.length > 0) {
      await db
        .insert(userSettingsTable)
        .values(entries.map(([key, value]) => ({ key, value, updatedAt: new Date() })))
        .onConflictDoUpdate({
          target: userSettingsTable.key,
          set: {
            value: sql`excluded.value`,
            updatedAt: new Date(),
          },
        });
    }
    const rows = await db.select().from(userSettingsTable);
    res.json(rowsToSettings(rows));
  } catch (err) {
    res.status(500).json({ error: `Failed to import settings: ${(err as Error).message}` });
  }
});

router.get("/settings/server-env", (_req, res): void => {
  res.json(serverEnvPayload());
});

router.patch("/settings/server-env", (req, res): void => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "Body must be a JSON object" });
    return;
  }

  const patch: ServerEnvPatch = {};
  const map: Record<string, keyof ServerEnvPatch> = {
    polygonApiKey: "POLYGON_API_KEY",
    tastytradeUsername: "TASTYTRADE_USERNAME",
    tastytradeAccountNumber: "TASTYTRADE_ACCOUNT_NUMBER",
    tastytradeClientId: "TASTYTRADE_CLIENT_ID",
    tastytradeClientSecret: "TASTYTRADE_CLIENT_SECRET",
    tastytradeRedirectUri: "TASTYTRADE_REDIRECT_URI",
    tastytradeRefreshToken: "TASTYTRADE_REFRESH_TOKEN",
  };

  for (const [inputKey, envKey] of Object.entries(map)) {
    const value = body[inputKey];
    if (typeof value === "string") {
      patch[envKey] = value.trim();
    }
  }

  updateServerEnv(patch);
  res.json(serverEnvPayload());
});

export default router;
