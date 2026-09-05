import { describe, expect, it } from "vitest";
import { buildWeekRows, cellReplaceMatches, entriesForRow } from "../src/aggregation";
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

  it("同名任务行存在时,未关联的同名条目归入该任务行格子(不消失)", () => {
    const taskRow = { taskId: "t1", projectId: "p1", title: "联调", adhoc: false };
    const list: Entry[] = [
      { ...e("a", "2026-09-01", "p1", "联调"), taskId: null }, // 先有的条目
      { ...e("b", "2026-09-01", "p1", "联调"), taskId: "t1" }, // 后挂上的
    ];
    // buildWeekRows:同名条目被任务行覆盖,不再生成散录行
    const rows = buildWeekRows(projects, [{ id: "t1", projectId: "p1", title: "联调" }], list);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.adhoc).toBe(false);
    // 格子匹配:两种条目都计入任务行
    const cell = entriesForRow(taskRow, "2026-09-01", list, new Set(["t1"]));
    expect(cell).toHaveLength(2);
    // 整格替换谓词同样覆盖两种
    expect(list.filter((x) => cellReplaceMatches({ date: "2026-09-01", projectId: "p1", taskId: "t1", title: "联调" }, x))).toHaveLength(2);
  });

  it("行×日分组:任务行收 taskId 匹配与同名未关联,散举行按 项目+标题 且 taskId 为空", () => {
    const taskRow = { taskId: "t1", projectId: "p1", title: "联调", adhoc: false };
    const adhocRow = { taskId: null, projectId: "p1", title: "支援", adhoc: true };
    const list: Entry[] = [
      { ...e("a", "2026-09-01", "p1", "联调"), taskId: "t1" },
      { ...e("b", "2026-09-01", "p1", "联调"), taskId: "t1" },
      e("c", "2026-09-02", "p1", "联调"),
      e("d", "2026-09-01", "p1", "支援"),
    ];
    expect(entriesForRow(taskRow, "2026-09-01", list, new Set(["t1"]))).toHaveLength(2);
    expect(entriesForRow(taskRow, "2026-09-02", list, new Set(["t1"]))).toHaveLength(1);
    expect(entriesForRow(adhocRow, "2026-09-01", list, new Set())).toHaveLength(1);
  });

  it("整格替换谓词:taskId 行与散举行各自匹配同格条目", () => {
    const list: Entry[] = [
      { ...e("a", "2026-09-01", "p1", "联调"), taskId: "t1" },
      e("b", "2026-09-01", "p1", "支援"),
      e("c", "2026-09-02", "p1", "支援"),
    ];
    const cell = { date: "2026-09-01", projectId: "p1", taskId: "t1", title: "联调" };
    expect(list.filter((x) => cellReplaceMatches(cell, x)).map((x) => x.id)).toEqual(["a"]);
    const adhocCell = { date: "2026-09-01", projectId: "p1", taskId: null, title: "支援" };
    expect(list.filter((x) => cellReplaceMatches(adhocCell, x)).map((x) => x.id)).toEqual(["b"]);
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
