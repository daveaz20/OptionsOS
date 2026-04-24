import { Router, type IRouter } from "express";
import { db, userSettingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

type SettingsRecord = Record<string, unknown>;

function rowsToSettings(rows: Array<{ key: string; value: unknown }>): SettingsRecord {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
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

export default router;
