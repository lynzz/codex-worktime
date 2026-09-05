import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getDb, dbConfigured } from "./db";
import { projectsRouter } from "./routes/projects";
import { entriesRouter } from "./routes/entries";
import { tasksRouter } from "./routes/tasks";

export const api = new Hono();

api.route("/api/projects", projectsRouter);
api.route("/api/entries", entriesRouter);
api.route("/api/tasks", tasksRouter);

api.get("/api/health", async (c) => {
  if (!dbConfigured()) {
    return c.json({ ok: true, db: "not-configured" });
  }
  let last: { error: string; cause?: string } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await getDb().execute(sql`select 1`);
      return c.json({ ok: true, db: "up", attempt });
    } catch (error) {
      const cause = (error as Error & { cause?: { code?: string } }).cause;
      last = { error: (error as Error).message, cause: cause?.code };
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return c.json({ ok: false, db: "down", ...last }, 500);
});
