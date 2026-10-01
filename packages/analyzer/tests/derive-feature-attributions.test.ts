import { describe, expect, it } from "vitest";

import { deriveFeatureAttributions } from "../src/attribution/derive-feature-attributions.js";

describe("deriveFeatureAttributions", () => {
  it("prioritizes explicit ticket evidence, ignores merge commits, and never returns commit timestamps", () => {
    const result = deriveFeatureAttributions({
      features: [
        { id: "billing", name: "Billing export", ticketRefs: ["PROJ-42"] },
        { id: "search", name: "Search" }
      ],
      commits: [
        { id: "merge", subject: "Merge branch feature/billing", isMerge: true, authoredAt: "SENTINEL_TIMESTAMP" },
        { id: "explicit", subject: "refactor: internals", ticketRefs: ["PROJ-42"], authoredAt: "SENTINEL_TIMESTAMP" },
        { id: "subject", subject: "feat(search): add filters", paths: ["src/search.ts"], authoredAt: "SENTINEL_TIMESTAMP" }
      ]
    });

    expect(result).toEqual([
      { featureId: "billing", featureName: "Billing export", commitId: "explicit", evidence: "explicit-ticket", confidence: "high", suggested: false },
      { featureId: "search", featureName: "Search", commitId: "subject", evidence: "commit-subject", confidence: "medium", suggested: false }
    ]);
    expect(JSON.stringify(result)).not.toContain("SENTINEL_TIMESTAMP");
  });

  it("labels semantic matches as low-confidence suggestions and keeps technical scopes separate", () => {
    const result = deriveFeatureAttributions({
      features: [{ id: "billing", name: "Billing export", keywords: ["invoice"] }],
      commits: [
        { id: "technical", subject: "refactor(database): indexes", scope: "database" },
        { id: "semantic", subject: "improve invoice workflow" }
      ]
    });

    expect(result).toEqual([
      { featureId: "billing", featureName: "Billing export", commitId: "semantic", evidence: "semantic", confidence: "low", suggested: true }
    ]);
  });

  it("uses merge subject only as evidence for an explicitly associated non-merge delivery commit", () => {
    const result = deriveFeatureAttributions({
      features: [{ id: "billing", name: "Billing" }],
      commits: [
        { id: "delivery", subject: "chore: release" },
        { id: "merge", subject: "Merge billing feature", isMerge: true, mergedCommitIds: ["delivery"] }
      ]
    });
    expect(result).toEqual([
      { featureId: "billing", featureName: "Billing", commitId: "delivery", evidence: "merge-subject", confidence: "medium", suggested: false }
    ]);
  });
});
