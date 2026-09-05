import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { dbConfigured, getDb } from "./db";

export const api = new Hono();

api.get("/api/health", async (c) => {
  if (!dbConfigured()) {
    return c.json({ ok: true, db: "not-configured" });
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await getDb().execute(sql`select 1`);
      return c.json({ ok: true, db: "up", attempt });
    } catch (error) {
      const message = (error as Error).message;
      const cause = (error as Error & { cause?: { code?: string } }).cause;
      if (attempt === 2) {
        return c.json(
          { ok: false, db: "down", error: message, cause: cause?.code },
          500,
        );
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return c.json({ ok: false, db: "down" }, 500);
});
