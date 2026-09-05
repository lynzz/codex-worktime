import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { api } from "../src/api";
import { getDb } from "../src/db";
import { entries, projects } from "../src/schema";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

function post(url: string, body: unknown) {
  return api.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasTestDb)("tasks API(集成,Neon test 分支)", () => {
  let projectId: string;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`truncate table entries, tasks, projects cascade`);
    await db.insert(projects).values({ id: "p1", name: "EQA", archived: false });
    projectId = "p1";
  });

  it("创建/列表任务行;同项目同名拒绝 400;跨项目同名允许", async () => {
    const created = await post("/api/tasks", { projectId, title: "登录页联调" });
    expect(created.status).toBe(201);

    const dup = await post("/api/tasks", { projectId, title: "登录页联调" });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toContain("同名");

    await getDb()
      .insert(projects)
      .values({ id: "p2", name: "CQB", archived: false });
    const otherProject = await post("/api/tasks", {
      projectId: "p2",
      title: "登录页联调",
    });
    expect(otherProject.status).toBe(201);

    const list = await api.request("/api/tasks");
    expect(((await list.json()) as unknown[]).length).toBe(2);
  });

  it("条目标题与任务行精确匹配时自动关联 taskId", async () => {
    const task = (await (await post("/api/tasks", {
      projectId,
      title: "登录页联调",
    })).json()) as { id: string };

    const matched = await post("/api/entries", {
      date: "2026-09-05",
      projectId,
      title: "登录页联调",
      minutes: 60,
    });
    expect(((await matched.json()) as { taskId: string | null }).taskId).toBe(
      task.id,
    );

    const unmatched = await post("/api/entries", {
      date: "2026-09-05",
      projectId,
      title: "临时支援",
      minutes: 30,
    });
    expect(((await unmatched.json()) as { taskId: string | null }).taskId).toBeNull();
  });

  it("删除任务行:条目保留且 taskId 置空(降级散录)", async () => {
    const task = (await (await post("/api/tasks", {
      projectId,
      title: "登录页联调",
    })).json()) as { id: string };
    const entry = (await (await post("/api/entries", {
      date: "2026-09-05",
      projectId,
      title: "登录页联调",
      minutes: 60,
    })).json()) as { id: string };

    const removed = await api.request(`/api/tasks/${task.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);

    const rows = await getDb().select().from(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(entry.id);
    expect(rows[0]!.taskId).toBeNull();

    const ghost = await api.request("/api/tasks/ghost", { method: "DELETE" });
    expect(ghost.status).toBe(404);
  });
});
