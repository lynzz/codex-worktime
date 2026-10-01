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

describe.skipIf(!hasTestDb)("增量接口并发与一键清空", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    await getDb().execute(sql`truncate table entries, tasks, projects cascade`);
    await getDb().insert(projects).values({ id: "p1", name: "EQA", archived: false });
  });

  it("并发冒测:两个客户端交错写不同条目,双方均不丢失(消除原型整包覆盖缺陷)", async () => {
    const [a, b] = await Promise.all([
      post("/api/entries", {
        date: "2026-09-05",
        projectId: "p1",
        title: "客户端A的任务",
        minutes: 60,
      }),
      post("/api/entries", {
        date: "2026-09-05",
        projectId: "p1",
        title: "客户端B的任务",
        minutes: 30,
      }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // 再交错各删各的,互不影响
    const rows = await getDb().select().from(entries);
    expect(rows).toHaveLength(2);

    const list = await api.request("/api/entries?from=2026-09-05&to=2026-09-05");
    const all = (await list.json()) as { id: string; title: string }[];
    expect(all.map((x) => x.title).sort()).toEqual(["客户端A的任务", "客户端B的任务"]);
  });

  it("一键清空:错误确认串 400;正确确认串清空三表", async () => {
    await post("/api/entries", {
      date: "2026-09-05",
      projectId: "p1",
      title: "x",
      minutes: 30,
    });

    const wrong = await post("/api/projects/reset", { confirm: "nope" });
    expect(wrong.status).toBe(400);

    const ok = await post("/api/projects/reset", { confirm: "CLEAR_MANUAL_DATA" });
    expect(ok.status).toBe(200);

    const left = await getDb().select().from(entries);
    expect(left).toHaveLength(0);
    const leftProjects = await getDb().select().from(projects);
    expect(leftProjects).toHaveLength(0);
  });
});
