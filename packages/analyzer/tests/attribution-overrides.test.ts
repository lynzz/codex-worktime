import { describe, expect, it } from "vitest";

import { applyAttributionOverride, revokeAttributionOverride } from "../src/attribution/attribution-overrides.js";

describe("attribution overrides", () => {
  it("preserves original inference in append-only, reversible override records", () => {
    const original = { featureId: "billing", featureName: "Billing", commitId: "commit", evidence: "semantic" as const, confidence: "low" as const, suggested: true };
    const override = applyAttributionOverride({ id: "override-1", attribution: original, replacementFeatureId: "invoicing", reason: "Reviewed ticket" });

    expect(override).toMatchObject({ id: "override-1", active: true, original, replacementFeatureId: "invoicing" });
    expect(revokeAttributionOverride(override, "No longer applicable")).toMatchObject({ active: false, revokedReason: "No longer applicable", original });
  });
});
