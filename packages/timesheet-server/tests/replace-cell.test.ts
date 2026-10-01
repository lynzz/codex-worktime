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

describe.skipIf(!hasTestDb)("replace-cell(周网格整格替换)", () => {
  let taskId: string;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`truncate table entries, tasks, projects cascade`);
    await db.insert(projects).values({ id: "p1", name: "EQA", archived: false });
    const task = (await (await post("/api/tasks", {
      projectId: "p1",
      title: "联调",
    })).json()) as { id: string };
    taskId = task.id;
    await post("/api/entries", { date: "2026-09-01", projectId: "p1", title: "联调", minutes: 60 });
    await post("/api/entries", { date: "2026-09-01", projectId: "p1", title: "支援", minutes: 30 });
    await post("/api/entries", { date: "2026-09-01", projectId: "p1", title: "支援", minutes: 15 });
  });

  it("任务格:多记录整格替换为单条,标题取任务行快照", async () => {
    await post("/api/entries", { date: "2026-09-01", projectId: "p1", title: "联调", minutes: 30 });

    const res = await post("/api/entries/replace-cell", {
      date: "2026-09-01",
      projectId: "p1",
      taskId,
      minutes: 90,
    });
    expect(res.status).toBe(200);

    const rows = await getDb().select().from(entries);
    const lianTiao = rows.filter((r) => r.taskId === taskId);
    expect(lianTiao).toHaveLength(1);
    expect(lianTiao[0]!.minutes).toBe(90);
    expect(lianTiao[0]!.title).toBe("联调");
    // 其他格子不受影响
    expect(rows.filter((r) => r.title === "支援")).toHaveLength(2);
  });

  it("散录格:按 项目+标题 聚合替换;清空(minutes=null)只删不插", async () => {
    const res = await post("/api/entries/replace-cell", {
      date: "2026-09-01",
      projectId: "p1",
      taskId: null,
      title: "支援",
      minutes: 45,
    });
    expect(res.status).toBe(200);
    let rows = await getDb().select().from(entries);
    expect(rows.filter((r) => r.title === "支援")).toHaveLength(1);
    expect(rows.find((r) => r.title === "支援")!.minutes).toBe(45);

    const clear = await post("/api/entries/replace-cell", {
      date: "2026-09-01",
      projectId: "p1",
      taskId: null,
      title: "支援",
      minutes: null,
    });
    expect(clear.status).toBe(200);
    rows = await getDb().select().from(entries);
    expect(rows.filter((r) => r.title === "支援")).toHaveLength(0);
    expect(rows.filter((r) => r.title === "联调")).toHaveLength(1);
  });

  it("未知项目/任务行 → 404;非法时长 → 400", async () => {
    const noProject = await post("/api/entries/replace-cell", {
      date: "2026-09-01",
      projectId: "ghost",
      taskId: null,
      title: "x",
      minutes: 30,
    });
    expect(noProject.status).toBe(404);

    const noTask = await post("/api/entries/replace-cell", {
      date: "2026-09-01",
      projectId: "p1",
      taskId: "ghost",
      minutes: 30,
    });
    expect(noTask.status).toBe(404);

    const bad = await post("/api/entries/replace-cell", {
      date: "2026-09-01",
      projectId: "p1",
      taskId: null,
      title: "x",
      minutes: 0,
    });
    expect(bad.status).toBe(400);
  });
});
