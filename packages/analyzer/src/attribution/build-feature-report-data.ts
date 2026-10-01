import { aggregateFeatureIntervals, type FeatureIntervalLink, type VerifiedInterval } from "./aggregate-feature-intervals.js";
import { deriveFeatureAttributions, type CommitEvidence, type Feature } from "./derive-feature-attributions.js";
import type { AttributionOverride } from "./attribution-overrides.js";

export function buildFeatureReportData(input: { features: readonly Feature[]; commits: readonly CommitEvidence[]; intervals: readonly VerifiedInterval[]; links: readonly FeatureIntervalLink[]; overrides?: readonly AttributionOverride[] }) {
  const derived = deriveFeatureAttributions({ features: input.features, commits: input.commits });
  const replacements = new Map(
    input.overrides?.filter((override) => override.active).map((override) => [`${override.original.featureId}:${override.original.commitId}`, override.replacementFeatureId]) ?? []
  );
  const featureAttributions = derived.map((attribution) => {
    const replacementFeatureId = replacements.get(`${attribution.featureId}:${attribution.commitId}`);
    const replacement = input.features.find((feature) => feature.id === replacementFeatureId);
    return replacement ? { ...attribution, featureId: replacement.id, featureName: replacement.name } : attribution;
  });
  return {
    featureAttributions,
    featureIntervalTotals: aggregateFeatureIntervals({
      intervals: input.intervals,
      links: input.links.map((link) => ({ ...link, featureId: replacements.get(`${link.featureId}:${link.attributionCommitId}`) ?? link.featureId }))
    })
  };
}
