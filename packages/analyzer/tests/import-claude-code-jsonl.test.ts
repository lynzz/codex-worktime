import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { importClaudeCodeJsonl } from "../src/history/import-claude-code-jsonl.js";
import { mergeCoverage } from "../src/history/merge-coverage.js";

const profile = { id: "eqa-platform", displayName: "EQA Platform", roots: [{ id: "score", path: "/private/eqa/score" }] };

describe("importClaudeCodeJsonl", () => {
  it("imports only direct user prompts and completed assistant turns without retaining message content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-claude-history-"));
    const path = join(directory, "session.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "user", timestamp: "2026-08-22T01:00:00Z", cwd: "/private/eqa/score", sessionId: "session-secret", promptId: "prompt-secret", uuid: "user-id", message: { content: "PROMPT_SENTINEL" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-08-22T01:01:00Z", cwd: "/private/eqa/score", sessionId: "session-secret", uuid: "tool-id", message: { stop_reason: "tool_use", content: "ASSISTANT_SENTINEL" } }),
      JSON.stringify({ type: "user", timestamp: "2026-08-22T01:01:10Z", cwd: "/private/eqa/score", sessionId: "session-secret", sourceToolAssistantUUID: "tool-id", uuid: "tool-result-id", message: { content: "TOOL_OUTPUT_SENTINEL" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-08-22T01:02:00Z", cwd: "/private/eqa/score", sessionId: "session-secret", uuid: "assistant-id", message: { stop_reason: "end_turn", content: "ASSISTANT_SENTINEL" } }),
      JSON.stringify({ type: "user", timestamp: "2026-08-23T01:00:00Z", cwd: "/outside/project", sessionId: "outside", uuid: "outside-id", message: { content: "OUTSIDE_SENTINEL" } })
    ].join("\n"));

    const imported = await importClaudeCodeJsonl({ profile, paths: [path], dateRange: { from: "2026-08-22", to: "2026-08-23" } });
    expect(imported.events).toMatchObject([
      { type: "UserPromptSubmit", source: "claude-history" },
      { type: "Stop", source: "claude-history" }
    ]);
    expect(imported.coverage).toEqual([{ date: "2026-08-22", status: "available" }, { date: "2026-08-23", status: "no-data" }]);
    expect(JSON.stringify(imported)).not.toContain("PROMPT_SENTINEL");
    expect(JSON.stringify(imported)).not.toContain("ASSISTANT_SENTINEL");
    expect(JSON.stringify(imported)).not.toContain("TOOL_OUTPUT_SENTINEL");
  });

  it("merges coverage conservatively across Codex and Claude Code sources", () => {
    expect(mergeCoverage([
      { date: "2026-08-22", status: "no-data" },
      { date: "2026-08-22", status: "available" },
      { date: "2026-08-23", status: "no-data" },
      { date: "2026-08-23", status: "unknown" }
    ])).toEqual([{ date: "2026-08-22", status: "available" }, { date: "2026-08-23", status: "unknown" }]);
  });
});
