import { describe, expect, it } from "vitest";

import { sanitizeHookEvent } from "../src/hooks/sanitize-hook-event.js";

describe("sanitizeHookEvent", () => {
  it("keeps only lifecycle metadata and produces an arrival-time-independent event identity", () => {
    const payload = {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-secret",
      turn_id: "turn-secret",
      cwd: "/private/eqa/score",
      model: "model-secret",
      transcript_path: "/private/transcript.jsonl",
      prompt: "PROMPT_SENTINEL"
    };

    const first = sanitizeHookEvent(payload, "2026-08-22T01:00:00Z");
    const replay = sanitizeHookEvent(payload, "2026-08-22T01:05:00Z");

    expect(first.id).toBe(replay.id);
    expect(replay.occurredAt).toBe("2026-08-22T01:05:00Z");
    expect(first).toMatchObject({
      occurredAt: "2026-08-22T01:00:00Z",
      type: "UserPromptSubmit",
      cwd: "/private/eqa/score",
      source: "hook"
    });
    expect(JSON.stringify(first)).not.toContain("PROMPT_SENTINEL");
    expect(JSON.stringify(first)).not.toContain("/private/transcript.jsonl");
    expect(JSON.stringify(first)).not.toContain("model-secret");
  });

  it("does not turn SessionEnd into a duration-bearing event", () => {
    expect(
      sanitizeHookEvent(
        { hook_event_name: "SessionEnd", session_id: "session", cwd: "/private/eqa/score" },
        "2026-08-22T01:00:00Z"
      )
    ).toMatchObject({ type: "SessionEnd", source: "hook" });
  });

  it("keeps an opaque tool invocation id for distinct tool lifecycle events", () => {
    const first = sanitizeHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "session",
        turn_id: "turn",
        tool_use_id: "tool-one",
        agent_id: "agent-one",
        cwd: "/private/eqa/score"
      },
      "2026-08-22T01:00:00Z"
    );
    const second = sanitizeHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "session",
        turn_id: "turn",
        tool_use_id: "tool-two",
        agent_id: "agent-one",
        cwd: "/private/eqa/score"
      },
      "2026-08-22T01:00:00Z"
    );

    expect(first.id).not.toBe(second.id);
  });

  it("rejects Hook events without the stable identity fields required to avoid undercounting", () => {
    expect(() =>
      sanitizeHookEvent(
        { hook_event_name: "UserPromptSubmit", session_id: "session", cwd: "/private/eqa/score" },
        "2026-08-22T01:00:00Z"
      )
    ).toThrow("turn_id is required");
  });
});
