import { Hono } from "hono";
import { and, asc, gte, lte, sql } from "drizzle-orm";
import { getDb, dbConfigured } from "./db.js";
import { projectsRouter } from "./routes/projects.js";
import { entriesRouter } from "./routes/entries.js";
import { tasksRouter } from "./routes/tasks.js";
import { aggregateTaskRows, buildTaskListWorkbook } from "./export-xlsx.js";
import { importPrototypeTimesheet } from "./import-prototype.js";
import { importTaskListWorkbook } from "./import-xlsx.js";
import { entries as entriesTable, projects as projectsTable } from "./schema.js";

export const api = new Hono();

// Excel 模板导入:?date=YYYY-MM-DD 指定条目目标日期(缺省今天)
api.post("/api/import/xlsx", async (c) => {
  const date = c.req.query("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "date 应为 YYYY-MM-DD" }, 400);
  }
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  try {
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: "缺少文件内容" }, 400);
    const result = await importTaskListWorkbook(body, targetDate);
    return c.json(result, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

// 幂等导入(原型 JSON / 本应用导出的 JSON,同一形状):重复导入按 id 跳过
api.post("/api/import", async (c) => {
  try {
    const result = await importPrototypeTimesheet(await c.req.json().catch(() => null));
    return c.json(result, 201);
  } catch (error) {
    const zod = error as { issues?: { message?: string }[] };
    return c.json(
      { error: zod.issues?.[0]?.message ?? "导入文件结构不符" },
      400,
    );
  }
});

// 页面已用内联 SVG 图标;此路由仅为消掉浏览器对 /favicon.ico 的 404 探测
api.get("/favicon.ico", (c) => c.body(null, 204));

api.route("/api/projects", projectsRouter);
api.route("/api/entries", entriesRouter);
api.route("/api/tasks", tasksRouter);

// 导出时间过滤:?month=YYYY-MM 或 ?from=YYYY-MM-DD&to=YYYY-MM-DD;缺省导出全部
function resolveExportRange(c: { req: { query: (k: string) => string | undefined }; json: (b: unknown, s: 400) => Response }):
  | { error: Response }
  | { from?: string; to?: string; label: string } {
  const month = c.req.query("month");
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (month && (from || to)) {
    return { error: c.json({ error: "month 与 from/to 不能同时使用" }, 400) };
  }
  if (month) {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return { error: c.json({ error: "month 应为 YYYY-MM" }, 400) };
    const [y, mo] = [Number(m[1]), Number(m[2])];
    const lastDay = new Date(y, mo, 0).getDate();
    return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}`, label: month.replaceAll("-", "") };
  }
  if (from || to) {
    const okDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
    if (!okDate(from) || !okDate(to)) {
      return { error: c.json({ error: "from 与 to 需成对提供,格式 YYYY-MM-DD" }, 400) };
    }
    return { from, to, label: `${from!.replaceAll("-", "")}-${to!.replaceAll("-", "")}` };
  }
  return { label: "all" };
}

// 按 EQA 平台任务清单模板导出 XLSX(聚合口径:项目+任务)
api.get("/api/export/xlsx", async (c) => {
  const range = resolveExportRange(c);
  if ("error" in range) return range.error;

  const db = getDb();
  const conditions = [];
  if (range.from) conditions.push(gte(entriesTable.date, range.from));
  if (range.to) conditions.push(lte(entriesTable.date, range.to));
  const [projects, entries] = await Promise.all([
    db.select().from(projectsTable).orderBy(asc(projectsTable.name)),
    db
      .select()
      .from(entriesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(entriesTable.date)),
  ]);
  const buffer = await buildTaskListWorkbook(aggregateTaskRows(projects, entries));
  c.header(
    "content-disposition",
    `attachment; filename="task-list-${range.label}.xlsx"; filename*=UTF-8''${encodeURIComponent(`工时任务清单_${range.label}`)}.xlsx`,
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
