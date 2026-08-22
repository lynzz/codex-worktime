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
});
