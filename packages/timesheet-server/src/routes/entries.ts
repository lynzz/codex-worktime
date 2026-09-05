import { Hono } from "hono";
import { z } from "zod";
import { and, asc, count, eq, gte, isNull, lte, sum } from "drizzle-orm";
import { getDb } from "../db.js";
import { entries, projects, tasks } from "../schema.js";
import {
  cellReplaceMatches,
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

// 全部条目的累计分钟(页头总工时徽章)
entriesRouter.get("/total", async (c) => {
  const rows = await getDb().select({ value: sum(entries.minutes) }).from(entries);
  return c.json({ minutes: rows[0]?.value ?? 0 });
});

const replaceCellSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectId: z.string().min(1),
  taskId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(200).nullable().optional(),
  minutes: z
    .number()
    .int()
    .min(1, "时长必须大于 0")
    .max(24 * 60)
    .nullable()
    .optional(),
});

// 周网格整格替换(原型验证语义):以「taskId 或 项目+标题」为键,
// 事务内删除该格全部条目后写入单条;minutes 缺省/为空 = 仅清格。
entriesRouter.post("/replace-cell", async (c) => {
  const parsed = replaceCellSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, 400);
  }
  const input = parsed.data;
  const date = input.date!;
  const projectId = input.projectId;
  const taskId = input.taskId ?? null;
  const minutes = input.minutes ?? null;

  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return c.json({ error: "项目不存在" }, 404);

  let title: string | null = null;
  if (taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task || task.projectId !== projectId) {
      return c.json({ error: "任务行不存在" }, 404);
    }
    title = task.title; // 标题快照
  } else {
    title = input.title ?? null;
    if (!title) return c.json({ error: "散录格需要 title" }, 400);
  }
  if (minutes === null && taskId === null && !title) {
    return c.json({ error: "缺少替换内容" }, 400);
  }

  const dayEntries = await db
    .select()
    .from(entries)
    .where(
      taskId
        ? and(eq(entries.date, date), eq(entries.taskId, taskId))
        : and(
            eq(entries.date, date),
            isNull(entries.taskId),
            eq(entries.projectId, projectId),
            eq(entries.title, title),
          ),
    );
  const ids = dayEntries.filter((x) => cellReplaceMatches({ date, projectId, taskId, title }, x)).map((x) => x.id);

  const result = await db.transaction(async (tx) => {
    for (const id of ids) {
      await tx.delete(entries).where(eq(entries.id, id));
    }
    if (minutes !== null) {
      const rows = await tx
        .insert(entries)
        .values({
          id: crypto.randomUUID(),
          date,
          projectId,
          title: title!,
          minutes,
          taskId,
          category: null,
          note: null,
        })
        .returning();
      return rows[0] ?? null;
    }
    return null;
  });
  return c.json({ ok: true, entry: result satisfies Entry | null });
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
