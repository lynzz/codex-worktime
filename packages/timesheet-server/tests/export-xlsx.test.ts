import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import ExcelJS from "exceljs";
import { testApi as api, resetTestData, TEST_USER_ID } from "./setup";
import { getDb } from "../src/db";
import { projects } from "../src/schema";
import { aggregateTaskRows, buildTaskListWorkbook } from "../src/export-xlsx";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

function post(url: string, body: unknown) {
  return api.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("aggregateTaskRows(聚合口径)", () => {
  const projects = [{ id: "p1", name: "EQA", archived: false }];
  const sample = [
    entry("e1", "2026-09-05", "联调", 90, "备注A"),
    entry("e2", "2026-09-04", "联调", 90, "备注A"),
    entry("e3", "2026-09-05", "联调", 60, "备注B"),
    entry("e4", "2026-09-03", "评审", 30, null),
  ];

  it("填日期:按 日期+项目+任务 合并分钟并去重备注,按日期升序排序", () => {
    expect(aggregateTaskRows(projects, sample, { fillDates: true })).toEqual([
      { date: "2026-09-03", projectName: "EQA", title: "评审", note: "", minutes: 30 },
      { date: "2026-09-04", projectName: "EQA", title: "联调", note: "备注A", minutes: 90 },
      { date: "2026-09-05", projectName: "EQA", title: "联调", note: "备注A / 备注B", minutes: 150 },
    ]);
  });

  it("不填日期:按 项目+任务 跨日合并,日期留空,按最早日期升序", () => {
    expect(aggregateTaskRows(projects, sample, { fillDates: false })).toEqual([
      { date: "", projectName: "EQA", title: "评审", note: "", minutes: 30 },
      { date: "", projectName: "EQA", title: "联调", note: "备注A / 备注B", minutes: 240 },
    ]);
  });
});

describe.skipIf(!hasTestDb)("GET /api/export/xlsx(模板导出,集成)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    const db = getDb();
    await resetTestData();
    await db.insert(projects).values({ id: "p1", userId: TEST_USER_ID, name: "EQA", archived: false });
    await post("/api/entries", { date: "2026-09-04", projectId: "p1", title: "生成证书联调", minutes: 180, note: "含联调环境" });
    await post("/api/entries", { date: "2026-09-05", projectId: "p1", title: "生成证书联调", minutes: 120 });
    await post("/api/entries", { date: "2026-09-05", projectId: "p1", title: "微生物字典 UI 调试", minutes: 90, category: "开发" });
  });

  it("按月份与时间范围过滤;非法参数 400", async () => {
    await post("/api/entries", { date: "2026-08-20", projectId: "p1", title: "八月旧任务", minutes: 60 });

    const titlesOf = async (url: string) => {
      const res = await api.request(url);
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      const titles: string[] = [];
      wb.getWorksheet("任务清单")!.eachRow((row, number) => {
        if (number >= 2) {
          const v = row.getCell(3).value;
          if (typeof v === "string") titles.push(v);
        }
      });
      return { headers: res.headers, titles };
    };

    const byMonth = await titlesOf("/api/export/xlsx?month=2026-09");
    expect(byMonth.headers.get("content-disposition")).toContain("task-list-202609.xlsx");
    expect(byMonth.titles).toContain("生成证书联调");
    expect(byMonth.titles).not.toContain("八月旧任务");

    const byRange = await titlesOf("/api/export/xlsx?from=2026-08-01&to=2026-08-31");
    expect(byRange.headers.get("content-disposition")).toContain(
      "task-list-20260801-20260831.xlsx",
    );
    expect(byRange.titles).toContain("八月旧任务");
    expect(byRange.titles).not.toContain("生成证书联调");

    const bad1 = await api.request("/api/export/xlsx?month=20269");
    expect(bad1.status).toBe(400);
    const bad2 = await api.request("/api/export/xlsx?from=2026-09-01");
    expect(bad2.status).toBe(400);
    const bad3 = await api.request("/api/export/xlsx?month=2026-09&from=2026-09-01&to=2026-09-30");
    expect(bad3.status).toBe(400);
    const bad4 = await api.request("/api/export/xlsx?fillDates=yes");
    expect(bad4.status).toBe(400);
  });

  it("fillDates=0:日期列留空,同任务跨日合并为一行", async () => {
    const res = await api.request("/api/export/xlsx?fillDates=0");
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.getWorksheet("任务清单")!;
    expect(ws.getCell("D1").value).toBe("日期");
    const rows = [2, 3].map((r) => {
      const row = ws.getRow(r);
      return [row.getCell(3).value, row.getCell(4).value, row.getCell(6).value];
    });
    expect(rows).toEqual([
      ["生成证书联调", "", 5],
      ["微生物字典 UI 调试", "", 1.5],
    ]);
    expect(ws.getCell("F5").formula).toBe("SUM(F2:F3)");
  });

  it("返回可解析的 xlsx:表头/按日期升序的行/成本公式/合计公式齐全", async () => {
    const res = await api.request("/api/export/xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.getWorksheet("任务清单");
    expect(ws).toBeDefined();

    expect(ws!.getRow(1).values).toEqual([
      undefined,
      "序号",
      "项目",
      "任务",
      "日期",
      "备注",
      "评估工时(人时)",
      "人力成本(元)",
    ]);

    // 数据行:日期升序,同日按标题排序
    const dataRows = [2, 3, 4].map((r) => {
      const row = ws!.getRow(r);
      return [row.getCell(4).value, row.getCell(3).value, row.getCell(6).value];
    });
    expect(dataRows).toEqual([
      ["2026-09-04", "生成证书联调", 3],
      ["2026-09-05", "生成证书联调", 2],
      ["2026-09-05", "微生物字典 UI 调试", 1.5],
    ]);
    expect(ws!.getCell("G2").formula).toBe("F2*150");

    // 合计行:总工时 + 总金额
    expect(ws!.getCell("E6").value).toBe("合计");
    expect(ws!.getCell("F6").formula).toBe("SUM(F2:F4)");
    expect(ws!.getCell("G6").formula).toBe("SUM(G2:G4)");
  });
});

describe("buildTaskListWorkbook(纯构建)", () => {
  it("空数据也能产出合法工作簿", async () => {
    const buffer = await buildTaskListWorkbook([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.getWorksheet("任务清单")).toBeDefined();
  });
});

function entry(
  id: string,
  date: string,
  title: string,
  minutes: number,
  note: string | null,
): Parameters<typeof aggregateTaskRows>[1][number] {
  return {
    id,
    date,
    projectId: "p1",
    title,
    minutes,
    taskId: null,
    category: null,
    note,
  };
}
