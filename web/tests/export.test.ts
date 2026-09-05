import { describe, expect, it } from "vitest";
import { buildTimesheetCsv } from "../src/lib/export";
import type { Entry, Project } from "@codex-worktime/timesheet-core";

const projects: Project[] = [
  { id: "p1", name: "EQA", archived: false },
];

const entries: Entry[] = [
  {
    id: "e2",
    date: "2026-09-04",
    projectId: "p1",
    title: "需求评审",
    minutes: 60,
    taskId: null,
    category: null,
    note: null,
  },
  {
    id: "e1",
    date: "2026-09-05",
    projectId: "p1",
    title: "登录页联调,含逗号",
    minutes: 90,
    taskId: null,
    category: "开发",
    note: '备注"引号"',
  },
];

describe("buildTimesheetCsv", () => {
  it("带 BOM,表头齐全,按日期排序,转义逗号与引号", () => {
    const csv = buildTimesheetCsv(entries, projects);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe('"日期","星期","项目","任务标题","类别","分钟","小时","备注"');
    expect(lines[1]).toContain('"2026-09-04"');
    expect(lines[1]).toContain('"需求评审"');
    expect(lines[2]).toContain('"登录页联调,含逗号"');
    expect(lines[2]).toContain('"备注""引号"""');
    expect(lines[2]).toContain('"90"');
    expect(lines[2]).toContain('"1.5"');
  });
});
