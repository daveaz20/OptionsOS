import { Router, type IRouter } from "express";
import { db, userSettingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getServerEnv, maskSecret, updateServerEnv, type ServerEnvPatch } from "../lib/server-env.js";
import { getTastytradeTokenExpiry, isTastytradeAuthorized, isTastytradeEnabled } from "../lib/tastytrade.js";

const router: IRouter = Router();

type SettingsRecord = Record<string, unknown>;

function rowsToSettings(rows: Array<{ key: string; value: unknown }>): SettingsRecord {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
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
