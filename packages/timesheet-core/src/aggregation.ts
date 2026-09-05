import type { Entry, Project, Task } from "./contracts.js";

// 周网格行:固定任务行(按项目分组)+ 散录聚合行(未挂任务行的条目按 项目+标题 聚合)。
// 任何已录数据都不会从网格消失(ADR-0003 / 原型验证语义)。
export type WeekRow = {
  taskId: string | null;
  projectId: string;
  title: string | null;
  adhoc: boolean;
};

export function buildWeekRows(
  projects: Project[],
  tasks: Task[],
  entriesInWeek: Entry[],
): WeekRow[] {
  const rows: WeekRow[] = [];
  const active = projects.filter((p) => !p.archived);
  for (const project of active) {
    tasks
      .filter((t) => t.projectId === project.id)
      .sort((a, b) => a.title.localeCompare(b.title, "zh"))
      .forEach((t) =>
        rows.push({ taskId: t.id, projectId: project.id, title: t.title, adhoc: false }),
      );
  }
  const seen = new Set(rows.map((r) => `${r.projectId}|${r.title ?? ""}`));
  for (const e of entriesInWeek) {
    if (tasks.some((t) => t.id === e.taskId)) continue; // 已挂任务行
    const key = `${e.projectId}|${e.title ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      rows.push({ taskId: null, projectId: e.projectId, title: e.title, adhoc: true });
    }
  }
  return rows;
}

// 某行某天的条目:任务行匹配 taskId,或"未挂任何任务行且与任务行同名"的条目
// (先有条目、后建同名任务行/导入建档时,条目应显示在该任务行下);
// 散举行按 项目+标题 且未挂任务行 匹配。
// taskIds = 现存任务行 id 集合(用于判定条目的 taskId 是否仍指向任务行)。
export function entriesForRow(
  row: WeekRow,
  date: string,
  entries: Entry[],
  taskIds: Set<string>,
): Entry[] {
  return entries.filter((e) => {
    if (e.date !== date) return false;
    if (row.taskId) {
      return (
        e.taskId === row.taskId ||
        (e.taskId === null &&
          e.projectId === row.projectId &&
          e.title === row.title)
      );
    }
    return (
      e.taskId === null &&
      e.projectId === row.projectId &&
      e.title === row.title
    );
  });
}

// 整格替换的删除谓词(与服务端 replace-cell 语义一致):
// 任务格删除 taskId 匹配或同名未关联的条目;散录格按 项目+标题。
export function cellReplaceMatches(
  input: { date: string; projectId: string; taskId: string | null; title: string | null },
  entry: Entry,
): boolean {
  if (entry.date !== input.date) return false;
  if (input.taskId) {
    return (
      entry.taskId === input.taskId ||
      (entry.taskId === null &&
        entry.projectId === input.projectId &&
        entry.title === input.title)
    );
  }
  return (
    entry.taskId === null &&
    entry.projectId === input.projectId &&
    entry.title === input.title
  );
}
