import { describe, expect, it } from "vitest";

import { buildFeatureReportData } from "../src/attribution/build-feature-report-data.js";

describe("buildFeatureReportData", () => {
  it("connects derivation to explicit evidence-linked verified interval totals without Git time", () => {
    const result = buildFeatureReportData({
      features: [{ id: "billing", name: "Billing", ticketRefs: ["BILL-1"] }],
      commits: [{ id: "commit", subject: "refactor", ticketRefs: ["BILL-1"], authoredAt: "TIMESTAMP_SENTINEL" }],
      intervals: [{ id: "interval", activeMinutes: 4, runMinutes: 2 }],
      links: [{ featureId: "billing", intervalId: "interval", evidence: "reviewed-ticket" }]
    });
    expect(result.featureAttributions).toHaveLength(1);
    expect(result.featureIntervalTotals).toEqual([{ featureId: "billing", activeMinutes: 4, runMinutes: 2, evidenceCount: 1 }]);
    expect(JSON.stringify(result)).not.toContain("TIMESTAMP_SENTINEL");
  });

  it("applies active overrides but ignores revoked ones", () => {
    const base = { features: [{ id: "billing", name: "Billing", ticketRefs: ["BILL-1"] }], commits: [{ id: "commit", subject: "x", ticketRefs: ["BILL-1"] }], intervals: [], links: [] };
    const original = { featureId: "billing", featureName: "Billing", commitId: "commit", evidence: "explicit-ticket" as const, confidence: "high" as const, suggested: false };
    expect(buildFeatureReportData({ ...base, overrides: [{ id: "active", original, replacementFeatureId: "invoicing", reason: "review", active: true }] }).featureAttributions[0]?.featureId).toBe("invoicing");
    expect(buildFeatureReportData({ ...base, overrides: [{ id: "revoked", original, replacementFeatureId: "invoicing", reason: "review", active: false, revokedReason: "undo" }] }).featureAttributions[0]?.featureId).toBe("billing");
  });
});
