import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { api } from "../src/api";
import { getDb } from "../src/db";
import { entries, projects } from "../src/schema";
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
  it("按 项目+任务 合并分钟并去重备注,按项目/标题排序", () => {
    const projects = [{ id: "p1", name: "EQA", archived: false }];
    const rows = aggregateTaskRows(projects, [
      entry("e1", "2026-09-04", "联调", 90, "备注A"),
      entry("e2", "2026-09-05", "联调", 90, "备注A"),
      entry("e3", "2026-09-05", "联调", 60, "备注B"),
      entry("e4", "2026-09-05", "评审", 30, null),
    ]);
    expect(rows).toEqual([
      { projectName: "EQA", title: "联调", note: "备注A / 备注B", minutes: 240 },
      { projectName: "EQA", title: "评审", note: "", minutes: 30 },
    ]);
  });
});

describe.skipIf(!hasTestDb)("GET /api/export/xlsx(模板导出,集成)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`truncate table entries, tasks, projects cascade`);
    await db.insert(projects).values({ id: "p1", name: "EQA", archived: false });
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
  });

  it("返回可解析的 xlsx:表头/聚合行/成本公式/汇总公式齐全", async () => {
    const res = await api.request("/api/export/xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.getWorksheet("任务清单");
    expect(ws).toBeDefined();

    expect(ws!.getRow(1).getCell(1).value).toBe("序号");
    expect(ws!.getRow(1).getCell(7).value).toBe("人力成本(元)");
    expect(ws!.getRow(1).getCell(6).value).toBe("评估工时(人时)");

    // 聚合行:两行任务,5 小时那条在前?按拼音排序,以实际顺序断言内容集合
    const row2 = ws!.getRow(2).values as unknown[];
    const row3 = ws!.getRow(3).values as unknown[];
    const titles = [row2[3], row3[3]];
    expect(titles).toContain("生成证书联调");
    expect(titles).toContain("微生物字典 UI 调试");
    const certRow = titles.indexOf("生成证书联调") === 0 ? row2 : row3;
    expect(certRow[6]).toBe(5); // 300 分钟 = 5 人时
    expect((certRow[7] as { formula?: string }).formula ?? certRow[7]).toContain("150");

    // 汇总公式
    const formulas: string[] = [];
    ws!.eachRow((row) => {
      row.eachCell((cell) => {
        const f = (cell.value as { formula?: string })?.formula;
        if (f) formulas.push(f);
      });
    });
    expect(formulas.some((f) => f.startsWith("COUNTIF"))).toBe(true);
    expect(formulas.some((f) => f.startsWith("SUMIF"))).toBe(true);
    expect(formulas.some((f) => /^SUM\(E/.test(f))).toBe(true);
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
