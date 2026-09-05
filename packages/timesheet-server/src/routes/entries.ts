import { Hono } from "hono";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../db";
import { entries, projects, tasks } from "../schema";
import {
  entryCreateSchema,
  entryPatchSchema,
  type Entry,
} from "@codex-worktime/timesheet-core";

export const entriesRouter = new Hono();

entriesRouter.get("/", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if ((from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(from)) ||
      (to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return c.json({ error: "from/to 应为 YYYY-MM-DD" }, 400);
  }
  const conditions = [];
  if (from) conditions.push(gte(entries.date, from));
  if (to) conditions.push(lte(entries.date, to));

  const rows = await getDb()
    .select()
    .from(entries)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(entries.date), asc(entries.title), asc(entries.id));
  return c.json(rows satisfies Entry[]);
});

entriesRouter.post("/", async (c) => {
  const parsed = entryCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, 400);
  }
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, parsed.data.projectId));
  if (!project) return c.json({ error: "项目不存在" }, 404);

  // 自动关联:同项目下与任务行标题精确匹配时挂上(原型验证语义)
  const sameProjectTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, parsed.data.projectId));
  const matchedTask = sameProjectTasks.find(
    (t) => t.title === parsed.data.title,
  );

  const rows = await db
    .insert(entries)
    .values({
      id: crypto.randomUUID(),
      date: parsed.data.date,
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      minutes: parsed.data.minutes,
      category: parsed.data.category ?? null,
      note: parsed.data.note ?? null,
      taskId: matchedTask?.id ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) return c.json({ error: "创建失败" }, 500);
  return c.json(row satisfies Entry, 201);
});

entriesRouter.patch("/:id", async (c) => {
  const parsed = entryPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, 400);
  }
  const updated = await getDb()
    .update(entries)
    .set(parsed.data)
    .where(eq(entries.id, c.req.param("id")))
    .returning();
  const row = updated[0];
  if (!row) return c.json({ error: "条目不存在" }, 404);
  return c.json(row satisfies Entry);
});

entriesRouter.delete("/:id", async (c) => {
  const deleted = await getDb()
    .delete(entries)
    .where(eq(entries.id, c.req.param("id")))
    .returning();
  if (!deleted[0]) return c.json({ error: "条目不存在" }, 404);
  return c.json({ ok: true });
});
