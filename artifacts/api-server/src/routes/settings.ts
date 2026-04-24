import { Router, type IRouter } from "express";
import { db, userSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const SINGLETON_ID = 1;

router.get("/settings", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(userSettingsTable).where(eq(userSettingsTable.id, SINGLETON_ID));
    res.json({ settings: rows[0]?.settings ?? {} });
  } catch (err) {
    res.status(500).json({ error: `Failed to load settings: ${(err as Error).message}` });
  }
});

router.patch("/settings", async (req, res): Promise<void> => {
  const incoming = req.body as Record<string, unknown>;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    res.status(400).json({ error: "Body must be a JSON object" });
    return;
  }
  try {
    const existing = await db.select().from(userSettingsTable).where(eq(userSettingsTable.id, SINGLETON_ID));
    const merged = { ...(existing[0]?.settings ?? {}), ...incoming };
    await db
      .insert(userSettingsTable)
      .values({ id: SINGLETON_ID, settings: merged, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userSettingsTable.id,
        set: { settings: merged, updatedAt: new Date() },
      });
    res.json({ settings: merged });
  } catch (err) {
    res.status(500).json({ error: `Failed to save settings: ${(err as Error).message}` });
  }
});

router.delete("/settings", async (_req, res): Promise<void> => {
  try {
    await db.delete(userSettingsTable).where(eq(userSettingsTable.id, SINGLETON_ID));
    res.json({ settings: {} });
  } catch (err) {
    res.status(500).json({ error: `Failed to reset settings: ${(err as Error).message}` });
  }
});

export default router;
