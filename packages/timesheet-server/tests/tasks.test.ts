import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
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

  it("改名:条目标题快照不回写、taskId 关联保持;重名/空名 400", async () => {
    const task = (await (await post("/api/tasks", {
      projectId,
      title: "登录页联调",
    })).json()) as { id: string; title: string };
    const entry = (await (await post("/api/entries", {
      date: "2026-09-05",
      projectId,
      title: "登录页联调",
      minutes: 60,
    })).json()) as { id: string; taskId: string | null; title: string };

    const renamed = await api.request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "登录页联调(二期)" }),
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { title: string }).title).toBe(
      "登录页联调(二期)",
    );

    // 条目保留旧快照与关联
    const [after] = await getDb().select().from(entries).where(eq(entries.id, entry.id));
    expect(after!.title).toBe("登录页联调");
    expect(after!.taskId).toBe(task.id);

    // 同项目重名拒绝
    await post("/api/tasks", { projectId, title: "另一个任务" });
    const dup = await api.request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "另一个任务" }),
    });
    expect(dup.status).toBe(400);

    // 空名拒绝;未知任务 404
    const blank = await api.request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  " }),
    });
    expect(blank.status).toBe(400);
    const ghost = await api.request("/api/tasks/ghost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(ghost.status).toBe(404);
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
