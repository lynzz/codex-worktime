import { describe, expect, it } from "vitest";

import { calculateIntervals } from "../src/accounting/calculate-intervals.js";

describe("calculateIntervals", () => {
  it("separates Active and Run Intervals, unions overlap, and excludes incomplete boundaries", () => {
    const result = calculateIntervals([
      { id: "turn-a", type: "UserPromptSubmit", occurredAt: "2026-08-22T01:00:00Z", sessionId: "a", turnId: "a1" },
      { id: "run-a-start", type: "PreToolUse", occurredAt: "2026-08-22T01:02:00Z", sessionId: "a", turnId: "a1", toolUseId: "tool-a" },
      { id: "turn-b", type: "UserPromptSubmit", occurredAt: "2026-08-22T01:05:00Z", sessionId: "b", turnId: "b1" },
      { id: "run-a-end", type: "PostToolUse", occurredAt: "2026-08-22T01:08:00Z", sessionId: "a", turnId: "a1", toolUseId: "tool-a" },
      { id: "turn-a-stop", type: "Stop", occurredAt: "2026-08-22T01:10:00Z", sessionId: "a", turnId: "a1" },
      { id: "turn-b-stop", type: "Stop", occurredAt: "2026-08-22T01:15:00Z", sessionId: "b", turnId: "b1" },
      { id: "incomplete", type: "UserPromptSubmit", occurredAt: "2026-08-22T02:00:00Z", sessionId: "a", turnId: "a2" }
    ]);

    expect(result.active.wallClockMinutes).toBe(15);
    expect(result.active.parallelMachineMinutes).toBe(20);
    expect(result.run.wallClockMinutes).toBe(6);
    expect(result.warnings).toContainEqual({ eventId: "incomplete", reason: "missing-turn-stop" });
  });

  it("deduplicates replayed lifecycle events and attributes UTC intervals to Asia/Shanghai days and weeks", () => {
    const result = calculateIntervals([
      { id: "start", type: "UserPromptSubmit", occurredAt: "2026-08-22T15:30:00Z", sessionId: "a", turnId: "a1" },
      { id: "start", type: "UserPromptSubmit", occurredAt: "2026-08-22T15:30:00Z", sessionId: "a", turnId: "a1" },
      { id: "stop", type: "Stop", occurredAt: "2026-08-22T16:30:00Z", sessionId: "a", turnId: "a1" }
    ]);

    expect(result.active.daily).toEqual([
      { date: "2026-08-22", minutes: 30 },
      { date: "2026-08-23", minutes: 30 }
    ]);
    expect(result.active.weekly).toEqual([
      { week: "2026-W34", minutes: 60 }
    ]);
  });
});
