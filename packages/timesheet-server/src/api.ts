import { Hono } from "hono";
import { asc, sql } from "drizzle-orm";
import { getDb, dbConfigured } from "./db.js";
import { projectsRouter } from "./routes/projects.js";
import { entriesRouter } from "./routes/entries.js";
import { tasksRouter } from "./routes/tasks.js";
import { aggregateTaskRows, buildTaskListWorkbook } from "./export-xlsx.js";
import { entries as entriesTable, projects as projectsTable } from "./schema.js";

export const api = new Hono();

api.route("/api/projects", projectsRouter);
api.route("/api/entries", entriesRouter);
api.route("/api/tasks", tasksRouter);

// 按 EQA 平台任务清单模板导出 XLSX(聚合口径:项目+任务)
api.get("/api/export/xlsx", async (c) => {
  const db = getDb();
  const [projects, entries] = await Promise.all([
    db.select().from(projectsTable).orderBy(asc(projectsTable.name)),
    db.select().from(entriesTable).orderBy(asc(entriesTable.date)),
  ]);
  const buffer = await buildTaskListWorkbook(aggregateTaskRows(projects, entries));
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  c.header(
    "content-disposition",
    `attachment; filename="task-list-${today}.xlsx"; filename*=UTF-8''${encodeURIComponent(`工时任务清单_${today}`)}.xlsx`,
  );
  c.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return c.body(new Uint8Array(buffer));
});

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
