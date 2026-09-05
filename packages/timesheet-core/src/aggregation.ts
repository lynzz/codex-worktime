import type { Entry, Project, Task } from "./contracts";

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
