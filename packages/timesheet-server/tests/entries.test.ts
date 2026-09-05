import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { api } from "../src/api";
import { getDb } from "../src/db";
import { projects } from "../src/schema";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

function post(url: string, body: unknown) {
  return api.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasTestDb)("entries API(集成,Neon test 分支)", () => {
  let projectId: string;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`truncate table entries, tasks, projects cascade`);
    const rows = await db
      .insert(projects)
      .values({ id: "p1", name: "EQA", archived: false })
      .returning();
    projectId = rows[0]!.id;
  });

  it("创建 → 按天查询 → 改标题 → 删除 全链路", async () => {
    const created = await post("/api/entries", {
      date: "2026-09-05",
      projectId,
      title: "登录页联调",
      minutes: 90,
      category: "开发",
      note: "与后端联调",
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string; minutes: number };
    expect(entry.minutes).toBe(90);

    const day = await api.request("/api/entries?from=2026-09-05&to=2026-09-05");
    expect(((await day.json()) as unknown[]).length).toBe(1);

    const renamed = await api.request(`/api/entries/${entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "登录页联调(续)" }),
    });
    expect(((await renamed.json()) as { title: string }).title).toBe(
      "登录页联调(续)",
    );

    const removed = await api.request(`/api/entries/${entry.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    const empty = await api.request("/api/entries?from=2026-09-05&to=2026-09-05");
    expect(((await empty.json()) as unknown[]).length).toBe(0);
  });

  it("区间过滤与排序(按日期)", async () => {
    await post("/api/entries", { date: "2026-09-01", projectId, title: "B", minutes: 30 });
    await post("/api/entries", { date: "2026-09-05", projectId, title: "A", minutes: 60 });
    await post("/api/entries", { date: "2026-09-10", projectId, title: "C", minutes: 45 });

    const range = await api.request("/api/entries?from=2026-09-02&to=2026-09-09");
    const rows = (await range.json()) as { date: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-09-05");
  });

  it("校验失败:缺标题/非法时长/非法日期 → 400 带中文信息", async () => {
    const noTitle = await post("/api/entries", {
      date: "2026-09-05",
      projectId,
      title: "  ",
      minutes: 30,
    });
    expect(noTitle.status).toBe(400);
    expect(((await noTitle.json()) as { error: string }).error).toContain("任务标题");

    const badMinutes = await post("/api/entries", {
      date: "2026-09-05",
      projectId,
      title: "x",
      minutes: 1.5,
    });
    expect(badMinutes.status).toBe(400);

    const badDate = await post("/api/entries", {
      date: "20260905",
      projectId,
      title: "x",
      minutes: 30,
    });
    expect(badDate.status).toBe(400);

    const badRange = await api.request("/api/entries?from=today");
    expect(badRange.status).toBe(400);
  });

  it("项目不存在 → 404;条目不存在 → 404", async () => {
    const noProject = await post("/api/entries", {
      date: "2026-09-05",
      projectId: "ghost",
      title: "x",
      minutes: 30,
    });
    expect(noProject.status).toBe(404);

    const noEntry = await api.request("/api/entries/ghost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(noEntry.status).toBe(404);
  });
});
