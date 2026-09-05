import { Hono } from "hono";
import { count, eq } from "drizzle-orm";
import { getDb } from "../db";
import { entries, projects, tasks } from "../schema";
import {
  projectCreateSchema,
  projectPatchSchema,
  type Project,
} from "@codex-worktime/timesheet-core";

export const projectsRouter = new Hono();

function badRequest(c: { json: (b: unknown, s: 400) => Response }, message: string) {
  return c.json({ error: message }, 400);
}

projectsRouter.get("/", async (c) => {
  const rows = await getDb()
    .select()
    .from(projects)
    .orderBy(projects.name);
  return c.json(rows satisfies Project[]);
});

projectsRouter.post("/", async (c) => {
  const parsed = projectCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(c, parsed.error.issues[0]?.message ?? "参数无效");
  }
  const rows = await getDb()
    .insert(projects)
    .values({ id: crypto.randomUUID(), name: parsed.data.name })
    .returning();
  const row = rows[0];
  if (!row) return c.json({ error: "创建失败" }, 500);
  return c.json(row satisfies Project, 201);
});

projectsRouter.patch("/:id", async (c) => {
  const parsed = projectPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(c, parsed.error.issues[0]?.message ?? "参数无效");
  }
  const updated = await getDb()
    .update(projects)
    .set(parsed.data)
    .where(eq(projects.id, c.req.param("id")))
    .returning();
  const row = updated[0];
  if (!row) return c.json({ error: "项目不存在" }, 404);
  return c.json(row satisfies Project);
});

projectsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb();
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) return c.json({ error: "项目不存在" }, 404);
  const counts = await db
    .select({ value: count() })
    .from(entries)
    .where(eq(entries.projectId, id));
  if ((counts[0]?.value ?? 0) > 0) {
    return c.json({ error: "项目仍有工时记录,不能删除,请改用归档" }, 409);
  }
  // 无工时记录时可删:任务行只是配置,随项目一并清理
  await db.delete(tasks).where(eq(tasks.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
  return c.json({ ok: true });
});
