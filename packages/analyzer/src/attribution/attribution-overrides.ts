import type { FeatureAttribution } from "./derive-feature-attributions.js";

export type AttributionOverride = { id: string; original: FeatureAttribution; replacementFeatureId: string; reason: string; active: boolean; revokedReason?: string };

export function applyAttributionOverride(input: { id: string; attribution: FeatureAttribution; replacementFeatureId: string; reason: string }): AttributionOverride {
  const { attribution, ...record } = input;
  return { ...record, original: attribution, active: true };
}

export function revokeAttributionOverride(override: AttributionOverride, revokedReason: string): AttributionOverride {
  return { ...override, active: false, revokedReason };
}
