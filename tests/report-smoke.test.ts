import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { generateProjectReport } from "../src/reporting/generate-project-report.js";

const profile = {
  id: "smoke-project",
  displayName: "Smoke project",
  roots: [{ id: "root", path: "/fixture/smoke" }]
};

describe("offline report smoke flow", () => {
  it("renders clear empty, missing-history, and valid-data states", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-report-smoke-"));
    const baseInput = { profile, databasePath: join(directory, "analytics.sqlite"), applicationDataDirectory: directory };
    const emptyPath = join(directory, "empty.html");
    const missingPath = join(directory, "missing-history.html");
    const validPath = join(directory, "valid.html");

    await generateProjectReport({ ...baseInput, events: [], htmlPath: emptyPath });
    await generateProjectReport({
      ...baseInput,
      events: [],
      coverage: [{ date: "2026-08-22", status: "unknown" }],
      htmlPath: missingPath
    });
    await generateProjectReport({
      ...baseInput,
      events: [
        { id: "start", occurredAt: "2026-08-22T01:00:00Z", type: "UserPromptSubmit", cwd: "/fixture/smoke", turnId: "turn" },
        { id: "stop", occurredAt: "2026-08-22T01:05:00Z", type: "Stop", cwd: "/fixture/smoke", turnId: "turn" }
      ],
      htmlPath: validPath
    });

    expect(await readFile(emptyPath, "utf8")).toContain("无数据");
    expect(await readFile(missingPath, "utf8")).toContain("未知（不主张工时）");
    const valid = await readFile(validPath, "utf8");
    expect(valid).toContain("已核验数据");
    expect(valid).toContain("5 分钟");
    expect(valid).toContain("未提供推断的功能归因，因此不主张低可信度归因");
  });
});
