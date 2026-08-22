import { describe, expect, it } from "vitest";

import { estimateFeatureCommitTime } from "../src/attribution/estimate-feature-commit-time.js";

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
});
