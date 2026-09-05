import { describe, expect, it } from "vitest";
import { buildWeekRows } from "../src/aggregation";
import type { Entry, Project, Task } from "../src/contracts";

const projects: Project[] = [
  { id: "p1", name: "EQA", archived: false },
  { id: "p2", name: "CQB", archived: false },
  { id: "p3", name: "归档项目", archived: true },
];

describe("buildWeekRows(任务行 + 散录聚合)", () => {
  it("固定任务行按项目分组、按标题排序;归档项目不出行", () => {
    const tasks: Task[] = [
      { id: "t2", projectId: "p1", title: "联调" },
      { id: "t1", projectId: "p1", title: "开发" },
      { id: "t3", projectId: "p3", title: "不应出现" },
    ];
    const rows = buildWeekRows(projects, tasks, []);
    expect(rows).toEqual([
      { taskId: "t1", projectId: "p1", title: "开发", adhoc: false },
      { taskId: "t2", projectId: "p1", title: "联调", adhoc: false },
    ]);
  });

  it("未挂任务行的条目按 项目+标题 聚合为散录行,不重复", () => {
    const entries: Entry[] = [
      e("e1", "2026-09-01", "p1", "临时支援"),
      e("e2", "2026-09-02", "p1", "临时支援"),
      e("e3", "2026-09-02", "p2", "评审"),
    ];
    const rows = buildWeekRows(projects, [], entries);
    expect(rows.filter((r) => r.adhoc)).toEqual([
      { taskId: null, projectId: "p1", title: "临时支援", adhoc: true },
      { taskId: null, projectId: "p2", title: "评审", adhoc: true },
    ]);
  });

  it("挂了任务行的条目不产生散录行", () => {
    const tasks: Task[] = [{ id: "t1", projectId: "p1", title: "联调" }];
    const entries = [e("e1", "2026-09-01", "p1", "联调")].map((x) => ({
      ...x,
      taskId: "t1",
    }));
    const rows = buildWeekRows(projects, tasks, entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.adhoc).toBe(false);
  });

  it("同名标题不同项目分别成行", () => {
    const entries = [
      e("e1", "2026-09-01", "p1", "评审"),
      e("e2", "2026-09-01", "p2", "评审"),
    ];
    const rows = buildWeekRows(projects, [], entries);
    expect(rows).toHaveLength(2);
  });
});

function e(
  id: string,
  date: string,
  projectId: string,
  title: string,
): Entry {
  return {
    id,
    date,
    projectId,
    title,
    minutes: 60,
    taskId: null,
    category: null,
    note: null,
  };
}
