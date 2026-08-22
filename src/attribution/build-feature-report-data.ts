import { aggregateFeatureIntervals, type FeatureIntervalLink, type VerifiedInterval } from "./aggregate-feature-intervals.js";
import { deriveFeatureAttributions, type CommitEvidence, type Feature } from "./derive-feature-attributions.js";
import type { AttributionOverride } from "./attribution-overrides.js";

export function buildFeatureReportData(input: { features: readonly Feature[]; commits: readonly CommitEvidence[]; intervals: readonly VerifiedInterval[]; links: readonly FeatureIntervalLink[]; overrides?: readonly AttributionOverride[] }) {
  const derived = deriveFeatureAttributions({ features: input.features, commits: input.commits });
  const featureAttributions = derived.map((attribution) => {
    const override = input.overrides?.find((candidate) => candidate.active && candidate.original.commitId === attribution.commitId && candidate.original.featureId === attribution.featureId);
    return override ? { ...attribution, featureId: override.replacementFeatureId } : attribution;
  });
  return {
    featureAttributions,
    featureIntervalTotals: aggregateFeatureIntervals({ intervals: input.intervals, links: input.links })
  };
}
