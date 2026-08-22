import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { importHistoricalJsonl } from "../src/history/import-historical-jsonl.js";
import { generateProjectReport } from "../src/reporting/generate-project-report.js";

const profile = {
  id: "eqa-platform",
  displayName: "EQA Platform",
  roots: [{ id: "score", path: "/private/eqa/score" }]
};

describe("importHistoricalJsonl", () => {
  it("imports only matching metadata, preserves coverage gaps, and is idempotent in the report store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-history-"));
    const historyPath = join(directory, "history.jsonl");
    const databasePath = join(directory, "analytics.sqlite");
    const htmlPath = join(directory, "report.html");

    await writeFile(
      historyPath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-08-22T01:00:00Z",
          payload: {
            cwd: "/private/eqa/score",
            session_id: "session-secret",
            parent_session_id: "parent-secret",
            prompt: "PROMPT_SENTINEL"
          }
        }),
        JSON.stringify({
          type: "turn_context",
          timestamp: "2026-08-22T01:02:00Z",
          payload: {
            cwd: "/private/eqa/score",
            session_id: "session-secret",
            turn_id: "turn-secret",
            assistant: "ASSISTANT_SENTINEL"
          }
        }),
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-08-22T01:03:00Z",
          payload: { cwd: "/outside/project", session_id: "other-session" }
        }),
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-08-23T01:03:00Z",
          payload: { cwd: "/outside/project", session_id: "other-session" }
        })
      ].join("\n")
    );

    const imported = await importHistoricalJsonl({
      profile,
      paths: [historyPath],
      dateRange: { from: "2026-08-22", to: "2026-08-24" }
    });

    expect(imported.events).toHaveLength(2);
    expect(imported.coverage).toEqual([
      { date: "2026-08-22", status: "available" },
      { date: "2026-08-23", status: "no-data" },
      { date: "2026-08-24", status: "unknown" }
    ]);

    await generateProjectReport({
      profile,
      events: imported.events,
      coverage: imported.coverage,
      databasePath,
      htmlPath,
      applicationDataDirectory: directory
    });
    await generateProjectReport({
      profile,
      events: imported.events,
      coverage: imported.coverage,
      databasePath,
      htmlPath,
      applicationDataDirectory: directory
    });

    const html = await readFile(htmlPath, "utf8");
    const database = await readFile(databasePath, "latin1");
    expect(html).toContain("2026-08-22: available");
    expect(html).toContain("2026-08-23: no data");
    expect(html).toContain("2026-08-24: unknown");
    expect(html).not.toContain("PROMPT_SENTINEL");
    expect(html).not.toContain("ASSISTANT_SENTINEL");
    expect(html).not.toContain("parent-secret");
    expect(database).not.toContain("PROMPT_SENTINEL");
    expect(database).not.toContain("ASSISTANT_SENTINEL");
    expect(database).not.toContain("parent-secret");
    expect(html).toContain("2 sanitized events matched");
  });

  it("marks a range unknown when a historical source cannot be read", async () => {
    const result = await importHistoricalJsonl({
      profile,
      paths: [join(tmpdir(), "missing-codex-history.jsonl")],
      dateRange: { from: "2026-08-22", to: "2026-08-22" }
    });

    expect(result).toEqual({
      events: [],
      coverage: [{ date: "2026-08-22", status: "unknown" }]
    });
  });
});
