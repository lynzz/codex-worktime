import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb } from "./db.js";
import { entries, projects, tasks, users } from "./schema.js";

// 原型(prototype/manual-time-entry)的数据形状:整包 {projects,tasks,entries}。
// start/end 等原型遗留字段被忽略(ADR-0003:日期粒度,无起止时间)。
const prototypeSchema = z.object({
  projects: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        archived: z.boolean().optional(),
      }),
    )
    .default([]),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        projectId: z.string().min(1),
        title: z.string().min(1),
      }),
    )
    .default([]),
  entries: z
    .array(
      z.object({
        id: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        projectId: z.string().min(1),
        title: z.string().min(1),
        minutes: z.number().int().positive(),
        taskId: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

type ImportCount = { inserted: number; skipped: number };

export async function importPrototypeTimesheet(raw: unknown, userId: string): Promise<{
  projects: ImportCount;
  tasks: ImportCount;
  entries: ImportCount;
}> {
  const parsed = prototypeSchema.parse(raw);
  const db = getDb();

  const projectIds = [...new Set([
    ...parsed.projects.map((p) => p.id),
    ...parsed.tasks.map((t) => t.projectId),
    ...parsed.entries.map((e) => e.projectId),
  ])];
  const taskIds = [...new Set([
    ...parsed.tasks.map((t) => t.id),
    ...parsed.entries.flatMap((e) => e.taskId ? [e.taskId] : []),
  ])];
  const entryIds = parsed.entries.map((e) => e.id);
  const [existingProjects, existingTasks, existingEntries] = await Promise.all([
    projectIds.length ? db.select().from(projects).where(inArray(projects.id, projectIds)) : [],
    taskIds.length ? db.select().from(tasks).where(inArray(tasks.id, taskIds)) : [],
    entryIds.length ? db.select().from(entries).where(inArray(entries.id, entryIds)) : [],
  ]);
  // Global ids remain stable: reject foreign collisions before any write.
  if ([...existingProjects, ...existingTasks, ...existingEntries].some((row) => row.userId !== userId)) {
    throw new HTTPException(404, { message: "导入引用的记录不存在" });
  }
  const availableProjects = new Set([
    ...existingProjects.map((p) => p.id),
    ...parsed.projects.map((p) => p.id),
  ]);
  // A skipped duplicate keeps the stored (or first incoming) task's project.
  const availableTasks = new Map(existingTasks.map((task) => [task.id, { projectId: task.projectId }]));
  for (const task of parsed.tasks) {
    if (!availableProjects.has(task.projectId)) {
      throw new HTTPException(404, { message: "项目不存在" });
    }
    if (!availableTasks.has(task.id)) availableTasks.set(task.id, { projectId: task.projectId });
  }
  for (const entry of parsed.entries) {
    if (!availableProjects.has(entry.projectId)) {
      throw new HTTPException(404, { message: "项目不存在" });
    }
    if (entry.taskId) {
      const task = availableTasks.get(entry.taskId);
      if (!task || task.projectId !== entry.projectId) {
        throw new HTTPException(404, { message: "任务行不存在" });
      }
    }
  }

  function chunks<T>(values: T[]): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < values.length; i += 100) result.push(values.slice(i, i + 100));
    return result;
  }
  const projectChunks = chunks(parsed.projects.map((p) => ({
    id: p.id, userId, name: p.name, archived: p.archived ?? false,
  })));
  const taskChunks = chunks(parsed.tasks.map((t) => ({
    id: t.id, userId, projectId: t.projectId, title: t.title,
  })));
  const entryChunks = chunks(parsed.entries.map((e) => ({
    id: e.id, userId, date: e.date, projectId: e.projectId,
    title: e.title, minutes: e.minutes, taskId: e.taskId ?? null,
    category: e.category ?? null, note: e.note ?? null,
  })));
  const statements = [
    ...projectChunks.map((values) => db.insert(projects).values(values).onConflictDoNothing().returning()),
    ...taskChunks.map((values) => db.insert(tasks).values(values).onConflictDoNothing().returning()),
    ...entryChunks.map((values) => db.insert(entries).values(values).onConflictDoNothing().returning()),
  ];
  // A competing import may claim a globally unique id after the preflight read.
  // Verify the final graph inside the same batch so foreign collisions roll back.
  const ownershipGuard = db.select({
    permitted: sql<number>`1 / case when exists (
      select 1 from projects p where p.id = any(${sql.param(projectIds)}::text[]) and p.user_id <> ${userId}
      union all
      select 1 from tasks t join projects p on p.id = t.project_id
      where t.id = any(${sql.param(taskIds)}::text[]) and (t.user_id <> ${userId} or p.user_id <> ${userId})
      union all
      select 1 from entries e join projects p on p.id = e.project_id left join tasks t on t.id = e.task_id
      where e.id = any(${sql.param(entryIds)}::text[]) and (
        e.user_id <> ${userId} or p.user_id <> ${userId}
        or (e.task_id is not null and (t.user_id <> ${userId} or t.project_id <> e.project_id))
      )
    ) then 0 else 1 end`,
  }).from(users).where(eq(users.id, userId));
  let rows: unknown[][];
  try {
    rows = statements.length ? await db.batch([statements[0]!, ...statements.slice(1), ownershipGuard]) : [];
  } catch (error) {
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "22012") {
      throw new HTTPException(404, { message: "导入引用的记录不存在" });
    }
    throw error;
  }
  let offset = 0;
  function countInserted(chunkCount: number, total: number): ImportCount {
    const inserted = rows.slice(offset, offset + chunkCount).reduce((sum, chunk) => sum + chunk.length, 0);
    offset += chunkCount;
    return { inserted, skipped: total - inserted };
  }
  return {
    projects: countInserted(projectChunks.length, parsed.projects.length),
    tasks: countInserted(taskChunks.length, parsed.tasks.length),
    entries: countInserted(entryChunks.length, parsed.entries.length),
  };
}
