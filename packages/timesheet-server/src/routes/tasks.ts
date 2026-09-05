import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../db.js";
import { entries, projects, tasks } from "../schema.js";
import {
  taskCreateSchema,
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

  const rows = await db
    .insert(tasks)
    .values({
      id: crypto.randomUUID(),
      projectId: parsed.data.projectId,
      title: parsed.data.title,
    })
    .returning();
  const row = rows[0];
  if (!row) return c.json({ error: "创建失败" }, 500);
  return c.json(row satisfies Task, 201);
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
