import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { api } from "../src/api";
import { getDb } from "../src/db";
import { entries, projects, tasks } from "../src/schema";
import { buildTaskListWorkbook } from "../src/export-xlsx";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

describe.skipIf(!hasTestDb)("POST /api/import/xlsx(模板导出→导回闭环)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    await getDb().execute(sql`truncate table entries, tasks, projects cascade`);
    await getDb().insert(projects).values({ id: "p1", name: "EQA", archived: false });
    await api.request("/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-09-04", projectId: "p1", title: "生成证书联调", minutes: 180 }),
    });
    await api.request("/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-09-05", projectId: "p1", title: "微生物字典 UI 调试", minutes: 90 }),
    });
  });

  it("导出 XLSX → 清库 → 导回:项目/任务行/条目按所选日期重建", async () => {
    // 导出(全量)
    const exported = await api.request("/api/export/xlsx");
    expect(exported.status).toBe(200);
    const buffer = await exported.arrayBuffer();

    // 清库后导回到指定日期
    await getDb().execute(sql`truncate table entries, tasks, projects cascade`);

    const imported = await api.request("/api/import/xlsx?date=2026-09-10", {
      method: "POST",
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: buffer,
    });
    expect(imported.status).toBe(201);
    const counts = (await imported.json()) as {
      projects: { created: number; existing: number };
      tasks: { created: number; existing: number };
      entries: { inserted: number; skipped: number };
    };
    expect(counts.projects.created).toBe(1);
    expect(counts.tasks.created).toBe(2);
    expect(counts.entries.inserted).toBe(2);

    const [project] = await getDb().select().from(projects);
    expect(project!.name).toBe("EQA");
    const taskRows = await getDb().select().from(tasks);
    expect(taskRows.map((t) => t.title).sort()).toEqual([
      "微生物字典 UI 调试",
      "生成证书联调",
    ]);
    const entryRows = await getDb().select().from(entries);
    expect(entryRows).toHaveLength(2);
    expect(entryRows.every((e) => e.date === "2026-09-10")).toBe(true);
    expect(entryRows.every((e) => e.taskId !== null)).toBe(true);
    const cert = entryRows.find((e) => e.title === "生成证书联调")!;
    expect(cert.minutes).toBe(180);

    // 再导一次同文件:同数值条目全部跳过(防手滑双导)
    const again = await api.request("/api/import/xlsx?date=2026-09-10", {
      method: "POST",
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: buffer,
    });
    const counts2 = (await again.json()) as {
      entries: { inserted: number; skipped: number };
    };
    expect(counts2.entries.inserted).toBe(0);
    expect(counts2.entries.skipped).toBe(2);
  });

  it("模板下载:空白任务清单可直接下载且可再导入", async () => {
    const res = await api.request("/api/import/template");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("task-list-template.xlsx");
    // 空模板导入报"没有可导入的任务行"(结构合法但无数据)
    const imported = await api.request("/api/import/xlsx?date=2026-09-05", {
      method: "POST",
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: await res.arrayBuffer(),
    });
    expect(imported.status).toBe(400);
    expect(((await imported.json()) as { error: string }).error).toContain(
      "没有可导入",
    );
  });

  it("行内日期优先,留空用默认日期;非法日期 400", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("任务清单");
    ws.addRow(["序号", "项目", "任务", "日期", "优先级", "备注", "评估工时(人时)", "人力成本(元)"]);
    ws.addRow([1, "EQA", "行内日期任务", "2026-09-08", "P1", "", 2, undefined]);
    ws.addRow([2, "EQA", "默认日期任务", "", "P1", "", 1, undefined]);
    ws.addRow([3, "EQA", "斜杠日期任务", "2026/9/9", "P1", "", 1, undefined]);
    const buffer = await wb.xlsx.writeBuffer();

    const res = await api.request("/api/import/xlsx?date=2026-09-10", {
      method: "POST",
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: buffer,
    });
    expect(res.status).toBe(201);
    const rows = await getDb().select().from(entries);
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.date]));
    expect(byTitle["行内日期任务"]).toBe("2026-09-08");
    expect(byTitle["默认日期任务"]).toBe("2026-09-10");
    expect(byTitle["斜杠日期任务"]).toBe("2026-09-09");

    const bad = wb.getWorksheet("任务清单")!;
    bad.getCell("D3").value = "明天";
    const badBuffer = await wb.xlsx.writeBuffer();
    const badRes = await api.request("/api/import/xlsx?date=2026-09-10", {
      method: "POST",
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: badBuffer,
    });
    expect(badRes.status).toBe(400);
    expect(((await badRes.json()) as { error: string }).error).toContain("日期格式");
  });

  it("Excel 序列日期数字也能解析", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("任务清单");
    ws.addRow(["序号", "项目", "任务", "日期", "优先级", "备注", "评估工时(人时)", "人力成本(元)"]);
    // 46271 = 2026-09-06 的 Excel 序列值
    ws.addRow([1, "EQA", "序列日期任务", 46271, "P1", "", 1, undefined]);
    const buffer = await wb.xlsx.writeBuffer();

    const res = await api.request("/api/import/xlsx", {
      method: "POST",
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: buffer,
    });
    expect(res.status).toBe(201);
    const rows = await getDb().select().from(entries);
    expect(rows.find((r) => r.title === "序列日期任务")?.date).toBe("2026-09-06");
  });

  it("非模板文件/坏参数 → 400 中文报错", async () => {
    const noFile = await api.request("/api/import/xlsx", {
      method: "POST",
      body: new ArrayBuffer(0),
    });
    expect(noFile.status).toBe(400);

    const notXlsx = await api.request("/api/import/xlsx", {
      method: "POST",
      body: "hello",
    });
    expect(notXlsx.status).toBe(400);

    const badDate = await api.request("/api/import/xlsx?date=20260910", {
      method: "POST",
      body: new ArrayBuffer(10),
    });
    expect(badDate.status).toBe(400);
  });
});
