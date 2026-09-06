import { Hono } from "hono";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db.js";
import { entries, projects, tasks } from "../schema.js";
import {
  taskCreateSchema,
  taskPatchSchema,
  type Task,
} from "@codex-worktime/timesheet-core";

export const tasksRouter = new Hono();

tasksRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(tasks)
    .orderBy(asc(tasks.title));
  return c.json(rows satisfies Task[]);
});

tasksRouter.post("/", async (c) => {
  const parsed = taskCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, 400);
  }
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, parsed.data.projectId));
  if (!project) return c.json({ error: "项目不存在" }, 404);

  const existing = await db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, parsed.data.projectId));
  if (existing.some((t) => t.title === parsed.data.title)) {
    return c.json({ error: "该项目下已存在同名任务行" }, 400);
  }

  const maxPosRows = await db
    .select({ value: sql<number>`coalesce(max(${tasks.position}), -1)` })
    .from(tasks);
  const maxPos = maxPosRows[0]?.value ?? -1;
  const rows = await db
    .insert(tasks)
    .values({
      id: crypto.randomUUID(),
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      position: Number(maxPos) + 1,
    })
    .returning();
  const row = rows[0];
  if (!row) return c.json({ error: "创建失败" }, 500);
  return c.json(row satisfies Task, 201);
});

// 拖动排序:ids 按新顺序传入,重写 position(0..n-1)
tasksRouter.post("/reorder", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null;
  if (!ids || ids.length === 0) {
    return c.json({ error: "ids 应为非空数组" }, 400);
  }
  const db = getDb();
  const existing = await db.select().from(tasks);
  const known = new Set(existing.map((t) => t.id));
  if (!ids.every((id) => known.has(id))) {
    return c.json({ error: "ids 中包含不存在的任务行" }, 404);
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(tasks).set({ position: i }).where(eq(tasks.id, ids[i]!));
    }
  });
  return c.json({ ok: true, count: ids.length });
});

// 改名:条目标题是快照,不回写(ADR-0003);taskId 关联保持,网格行显示新名
tasksRouter.patch("/:id", async (c) => {
  const parsed = taskPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, 400);
  }
  const db = getDb();
  const id = c.req.param("id");
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) return c.json({ error: "任务行不存在" }, 404);

  const siblings = await db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, existing.projectId));
  if (
    siblings.some((t) => t.id !== id && t.title === parsed.data!.title)
  ) {
    return c.json({ error: "该项目下已存在同名任务行" }, 400);
  }

  const updated = await db
    .update(tasks)
    .set({ title: parsed.data!.title })
    .where(eq(tasks.id, id))
    .returning();
  const row = updated[0];
  if (!row) return c.json({ error: "任务行不存在" }, 404);
  return c.json(row satisfies Task);
});

// 删除任务行:已登记条目保留,taskId 置空降级为散录(ADR-0003)
tasksRouter.delete("/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  if (!deleted[0]) return c.json({ error: "任务行不存在" }, 404);
  await db.update(entries).set({ taskId: null }).where(eq(entries.taskId, id));
  return c.json({ ok: true });
});
