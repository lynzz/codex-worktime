import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { appendOverride, listOverrides, revokeOverride } from "../src/attribution/persist-attribution-overrides.js";

describe("persistent attribution overrides", () => {
  it("appends original evidence and revocations without rewriting prior records", async () => {
    const databasePath = join(await mkdtemp(join(tmpdir(), "codex-worktime-overrides-")), "overrides.sqlite");
    const original = { featureId: "billing", featureName: "Billing", commitId: "commit", evidence: "semantic" as const, confidence: "low" as const, suggested: true };
    appendOverride(databasePath, { id: "override", attribution: original, replacementFeatureId: "invoicing", reason: "Reviewed" });
    revokeOverride(databasePath, "override", "Reversed");

    expect(listOverrides(databasePath)).toEqual([
      expect.objectContaining({ id: "override", original, replacementFeatureId: "invoicing", active: false, revokedReason: "Reversed" })
    ]);
  });
});
