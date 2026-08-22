import { describe, expect, it } from "vitest";

import { aggregateFeatureIntervals } from "../src/attribution/aggregate-feature-intervals.js";

describe("aggregateFeatureIntervals", () => {
  it("only aggregates verified intervals with explicit attribution evidence", () => {
    expect(aggregateFeatureIntervals({
      intervals: [{ id: "active-1", activeMinutes: 12, runMinutes: 5 }, { id: "active-2", activeMinutes: 8, runMinutes: 3 }],
      links: [{ featureId: "billing", intervalId: "active-1", evidence: "reviewed-ticket" }]
    })).toEqual([
      { featureId: "billing", activeMinutes: 12, runMinutes: 5, evidenceCount: 1 }
    ]);
  });
});
