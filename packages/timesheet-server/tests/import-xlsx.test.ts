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
