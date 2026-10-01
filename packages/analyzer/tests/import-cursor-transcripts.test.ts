import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { importCursorTranscripts } from "../src/history/import-cursor-transcripts.js";

describe("importCursorTranscripts", () => {
  it("counts timestamp-less Cursor transcript envelopes without retaining their content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-cursor-history-"));
    const path = join(directory, "session.jsonl");
    await writeFile(path, [
      JSON.stringify({ role: "user", message: { content: "PROMPT_SENTINEL" } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
      JSON.stringify({ role: "assistant", message: { content: "ASSISTANT_SENTINEL" } })
    ].join("\n"));

    const imported = await importCursorTranscripts({
      sources: [{ path, cwd: "/private/eqa/score", sessionId: "session-secret" }],
      dateRange: { from: "2026-08-22", to: "2026-08-22" }
    });

    expect(imported).toMatchObject({ events: [], detectedSessionCount: 1, directPromptCount: 1, completedTurnCount: 1, missingTimestampCount: 2 });
    expect(imported.coverage).toEqual([{ date: "2026-08-22", status: "unknown" }]);
    expect(JSON.stringify(imported)).not.toContain("PROMPT_SENTINEL");
    expect(JSON.stringify(imported)).not.toContain("ASSISTANT_SENTINEL");
    expect(JSON.stringify(imported)).not.toContain("session-secret");
  });

  it("imports only timestamped prompts and successful completed turns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-cursor-history-"));
    const path = join(directory, "session.jsonl");
    await writeFile(path, [
      JSON.stringify({ role: "user", timestamp: "2026-08-22T01:00:00Z", message: { content: "PROMPT_SENTINEL" } }),
      JSON.stringify({ type: "turn_ended", status: "success", timestamp: "2026-08-22T01:02:00Z" }),
      JSON.stringify({ type: "turn_ended", status: "error", timestamp: "2026-08-22T01:03:00Z" })
    ].join("\n"));

    const imported = await importCursorTranscripts({ sources: [{ path, cwd: "/private/eqa/score", sessionId: "session-secret" }] });
    expect(imported.events).toMatchObject([{ type: "UserPromptSubmit", source: "cursor-history" }, { type: "Stop", source: "cursor-history" }]);
    expect(JSON.stringify(imported)).not.toContain("PROMPT_SENTINEL");
  });
});
