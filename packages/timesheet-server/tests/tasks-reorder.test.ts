import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { api } from "../src/api";
import { getDb } from "../src/db";
import { projects, tasks } from "../src/schema";
import { buildWeekRows } from "@codex-worktime/timesheet-core";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

function post(url: string, body: unknown) {
  return api.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasTestDb)("任务行拖动排序", () => {
  let ids: string[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`truncate table entries, tasks, projects cascade`);
    await db.insert(projects).values({ id: "p1", name: "EQA", archived: false });
    ids = [];
    for (const title of ["任务A", "任务B", "任务C"]) {
      const res = await post("/api/tasks", { projectId: "p1", title });
      ids.push(((await res.json()) as { id: string }).id);
    }
  });

  it("创建按追加顺序得到递增 position", async () => {
    const rows = await getDb().select().from(tasks);
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.position]));
    expect(byTitle["任务A"]).toBe(0);
    expect(byTitle["任务B"]).toBe(1);
    expect(byTitle["任务C"]).toBe(2);
  });

  it("reorder 重写 position;网格行序按 position", async () => {
    const [a, b, c] = ids as [string, string, string];
    const res = await post("/api/tasks/reorder", { ids: [c, a, b] });
    expect(res.status).toBe(200);

    const rows = await getDb().select().from(tasks);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[c]!.position).toBe(0);
    expect(byId[a]!.position).toBe(1);
    expect(byId[b]!.position).toBe(2);

    const project = { id: "p1", name: "EQA", archived: false };
    const weekRows = buildWeekRows([project], rows, []);
    expect(weekRows.map((r) => r.title)).toEqual(["任务C", "任务A", "任务B"]);
  });

  it("非法载荷:空数组/含未知 id → 400/404", async () => {
    const empty = await post("/api/tasks/reorder", { ids: [] });
    expect(empty.status).toBe(400);
    const ghost = await post("/api/tasks/reorder", { ids: ["ghost"] });
    expect(ghost.status).toBe(404);
    const junk = await post("/api/tasks/reorder", {});
    expect(junk.status).toBe(400);
  });
});
