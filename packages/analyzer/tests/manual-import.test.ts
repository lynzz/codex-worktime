import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, entries } from "@codex-worktime/timesheet-server";
import { runCli } from "../src/index";

// 从仓库根 .env.local 取测试库连接串
const rootEnv = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.env.local",
);
try {
  process.loadEnvFile(rootEnv);
} catch {
  /* 未配置则跳过 */
}
const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

const fixture = {
  version: 1,
  projects: [{ id: "p1", name: "EQA", archived: false }],
  tasks: [{ id: "t1", projectId: "p1", title: "登录页联调" }],
  entries: [
    {
      id: "e1",
      date: "2026-09-05",
      projectId: "p1",
      title: "登录页联调",
      minutes: 90,
      taskId: "t1",
      category: "开发",
      note: "原型迁移",
      start: "14:00", // 原型遗留字段,应被忽略
      end: "15:30",
    },
    {
      id: "e2",
      date: "2026-09-04",
      projectId: "p1",
      title: "需求评审",
      minutes: 60,
      taskId: null,
      category: null,
      note: null,
    },
  ],
};

describe.skipIf(!hasTestDb)("manual import(原型 JSON 幂等迁移)", () => {
  let out: string[];
  let dir: string;
  let file: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
    await getDb().execute(sql`truncate table entries, tasks, projects cascade`);
    dir = await mkdtemp(path.join(os.tmpdir(), "timesheet-import-"));
    file = path.join(dir, "prototype.json");
    await writeFile(file, JSON.stringify(fixture), "utf8");
  });

  async function runImport(): Promise<{
    projects: { inserted: number; skipped: number };
    tasks: { inserted: number; skipped: number };
    entries: { inserted: number; skipped: number };
  }> {
    out = [];
    await runCli(["node", "codex-worktime", "manual", "import", file], {
      stdout: { write: (s: string) => void out.push(s) },
    });
    return JSON.parse(out.join("")) as never;
  }

  it("首次导入写入全部数据,忽略 start/end;重复导入全部跳过", async () => {
    const first = await runImport();
    expect(first.projects).toEqual({ inserted: 1, skipped: 0 });
    expect(first.tasks).toEqual({ inserted: 1, skipped: 0 });
    expect(first.entries).toEqual({ inserted: 2, skipped: 0 });

    const db = getDb();
    const rows = await db.select().from(entries);
    expect(rows).toHaveLength(2);

    const second = await runImport();
    expect(second.projects).toEqual({ inserted: 0, skipped: 1 });
    expect(second.tasks).toEqual({ inserted: 0, skipped: 1 });
    expect(second.entries).toEqual({ inserted: 0, skipped: 2 });

    const after = await getDb().select().from(entries);
    expect(after).toHaveLength(2);
  });
});
