import { z } from "zod";
import { getDb } from "./db.js";
import { entries, projects, tasks } from "./schema.js";

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

export async function importPrototypeTimesheet(raw: unknown): Promise<{
  projects: ImportCount;
  tasks: ImportCount;
  entries: ImportCount;
}> {
  const parsed = prototypeSchema.parse(raw);
  const db = getDb();

  async function upsert(
    table: typeof projects | typeof tasks | typeof entries,
    values: Record<string, unknown>[],
  ): Promise<InsertCount2> {
    let inserted = 0;
    for (let i = 0; i < values.length; i += 100) {
      const chunk = values.slice(i, i + 100);
      if (chunk.length === 0) continue;
      const rows = await db
        .insert(table)
        .values(chunk as never)
        .onConflictDoNothing()
        .returning();
      inserted += rows.length;
    }
    return { inserted, skipped: values.length - inserted };
  }

  const projectsResult = await upsert(
    projects,
    parsed.projects.map((p) => ({ id: p.id, name: p.name, archived: p.archived ?? false })),
  );
  const tasksResult = await upsert(
    tasks,
    parsed.tasks.map((t) => ({ id: t.id, projectId: t.projectId, title: t.title })),
  );
  const entriesResult = await upsert(
    entries,
    parsed.entries.map((e) => ({
      id: e.id,
      date: e.date,
      projectId: e.projectId,
      title: e.title,
      minutes: e.minutes,
      taskId: e.taskId ?? null,
      category: e.category ?? null,
      note: e.note ?? null,
    })),
  );
  return { projects: projectsResult, tasks: tasksResult, entries: entriesResult };
}

type InsertCount2 = { inserted: number; skipped: number };
