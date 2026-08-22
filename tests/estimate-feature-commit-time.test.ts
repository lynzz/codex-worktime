import { describe, expect, it } from "vitest";

import { estimateFeatureCommitTime, summarizeCommitsByDay, summarizeEstimatedCommitTimeByDay } from "../src/attribution/estimate-feature-commit-time.js";

describe("estimateFeatureCommitTime", () => {
  it("only accumulates immediately consecutive commits in the same scope and caps each gap at 60 minutes", () => {
    expect(estimateFeatureCommitTime([
      { id: "one", subject: "feat(report): first", authoredAt: "2026-07-01T09:00:00+08:00" },
      { id: "two", subject: "fix(report): second", authoredAt: "2026-07-01T09:20:00+08:00" },
      { id: "three", subject: "feat(admin): switch scope", authoredAt: "2026-07-01T09:30:00+08:00" },
      { id: "four", subject: "feat(report): new sequence", authoredAt: "2026-07-01T12:00:00+08:00" },
      { id: "five", subject: "fix(report): capped gap", authoredAt: "2026-07-01T14:00:00+08:00" },
      { id: "five", subject: "fix(report): duplicate from another root", authoredAt: "2026-07-01T14:00:00+08:00" }
    ])).toEqual([{ featureKey: "report", featureName: "report（提交 scope）", commitCount: 4, estimatedMinutes: 80 }]);
  });

  it("does not estimate a single commit or a scope change", () => {
    expect(estimateFeatureCommitTime([
      { id: "one", subject: "feat(report): first", authoredAt: "2026-07-01T09:00:00+08:00" },
      { id: "two", subject: "feat(admin): second", authoredAt: "2026-07-01T09:30:00+08:00" }
    ])).toEqual([]);
  });

  it("summarizes deduplicated commits by Asia/Shanghai day and keeps the three largest scopes", () => {
    expect(summarizeCommitsByDay([
      { id: "one", subject: "feat(report): first", authoredAt: "2026-07-01T16:30:00Z" },
      { id: "two", subject: "fix(report): second", authoredAt: "2026-07-01T17:00:00Z" },
      { id: "three", subject: "feat(admin): third", authoredAt: "2026-07-01T17:10:00Z" },
      { id: "four", subject: "feat(analysis): fourth", authoredAt: "2026-07-01T17:20:00Z" },
      { id: "five", subject: "feat(ui): fifth", authoredAt: "2026-07-01T17:30:00Z" },
      { id: "five", subject: "feat(ui): duplicate", authoredAt: "2026-07-01T17:30:00Z" }
    ])).toEqual([{ date: "2026-07-02", commitCount: 5, summary: "report（提交 scope） × 2 · admin（提交 scope） × 1 · analysis（提交 scope） × 1 · 等 1 项" }]);
  });

  it("assigns each estimated same-scope gap to the later commit's Asia/Shanghai day", () => {
    expect(summarizeEstimatedCommitTimeByDay([
      { id: "one", subject: "feat(report): first", authoredAt: "2026-07-01T15:50:00Z" },
      { id: "two", subject: "fix(report): second", authoredAt: "2026-07-01T16:10:00Z" },
      { id: "three", subject: "fix(report): third", authoredAt: "2026-07-01T16:40:00Z" }
    ])).toEqual([{ date: "2026-07-02", estimatedMinutes: 50, summary: "report（提交 scope） × 50 分钟" }]);
  });
});
