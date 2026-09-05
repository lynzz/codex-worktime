import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { api } from "../src/api";
import { getDb } from "../src/db";
import { entries } from "../src/schema";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

const payload = {
  projects: [{ id: "ip1", name: "导入项目", archived: false }],
  tasks: [{ id: "it1", projectId: "ip1", title: "导入任务行" }],
  entries: [
    {
      id: "ie1",
      date: "2026-09-05",
      projectId: "ip1",
      title: "导入任务行",
      minutes: 90,
      taskId: "it1",
      category: "开发",
      note: null,
    },
  ],
};

describe.skipIf(!hasTestDb)("POST /api/import(幂等导入)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    await getDb().execute(sql`truncate table entries, tasks, projects cascade`);
  });

  it("首次导入写入;重复导入全部跳过;数据一致", async () => {
    const first = await api.request("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      projects: { inserted: 1, skipped: 0 },
      tasks: { inserted: 1, skipped: 0 },
      entries: { inserted: 1, skipped: 0 },
    });

    const rows = await getDb().select().from(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe("it1");

    const second = await api.request("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(await second.json()).toEqual({
      projects: { inserted: 0, skipped: 1 },
      tasks: { inserted: 0, skipped: 1 },
      entries: { inserted: 0, skipped: 1 },
    });
    expect(await getDb().select().from(entries)).toHaveLength(1);
  });

  it("非法载荷 400(结构不符)", async () => {
    const bad = await api.request("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(bad.status).toBe(400);
  });
});
