import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { api } from "../src/api";
import { getDb } from "../src/db";
import { entries, projects, tasks } from "../src/schema";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

describe.skipIf(!hasTestDb)("projects API(集成,Neon test 分支)", () => {
  beforeAll(() => {
    // 指向独立 test 分支,避免触碰 production 数据
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    // 单条语句清空三表,减少跨境往返
    await getDb().execute(
      sql`truncate table entries, tasks, projects cascade`,
    );
  });

  it("创建 → 列表 → 改名 → 归档 → 恢复全链路", async () => {
    const created = await api.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  EQA Platform  " }),
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string; name: string };
    expect(project.name).toBe("EQA Platform"); // 首尾空白已去除

    const list = await api.request("/api/projects");
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const renamed = await api.request(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "EQA" }),
    });
    expect(((await renamed.json()) as { name: string }).name).toBe("EQA");

    const archived = await api.request(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    expect(((await archived.json()) as { archived: boolean }).archived).toBe(
      true,
    );

    const restored = await api.request(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
    expect(((await restored.json()) as { archived: boolean }).archived).toBe(
      false,
    );
  });

  it("校验失败返回 400 且带中文信息", async () => {
    const res = await api.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("项目名");
  });

  it("不存在的项目 PATCH/DELETE 返回 404", async () => {
    const patch = await api.request("/api/projects/nope", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(patch.status).toBe(404);
    const del = await api.request("/api/projects/nope", { method: "DELETE" });
    expect(del.status).toBe(404);
  });

  it("仍有条目的项目 DELETE 返回 409 并提示归档;清空条目后可删", async () => {
    const created = await api.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "EQA" }),
    });
    const { id } = (await created.json()) as { id: string };
    await getDb().insert(entries).values({
      id: "e1",
      date: "2026-09-05",
      projectId: id,
      title: "任意",
      minutes: 30,
    });

    const blocked = await api.request(`/api/projects/${id}`, {
      method: "DELETE",
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toContain(
      "归档",
    );

    await getDb().delete(entries).where(eq(entries.id, "e1"));
    const ok = await api.request(`/api/projects/${id}`, { method: "DELETE" });
    expect(ok.status).toBe(200);
    const list = await api.request("/api/projects");
    expect(((await list.json()) as unknown[]).length).toBe(0);
  });

  it("删除无条目的项目时,其任务行一并清理", async () => {
    const created = await api.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "EQA" }),
    });
    const { id } = (await created.json()) as { id: string };
    await getDb().insert(tasks).values({ id: "t1", projectId: id, title: "联调" });

    const ok = await api.request(`/api/projects/${id}`, { method: "DELETE" });
    expect(ok.status).toBe(200);
    const remaining = await getDb().select().from(tasks);
    expect(remaining).toHaveLength(0);
  });
});
