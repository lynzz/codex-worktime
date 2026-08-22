import { aggregateFeatureIntervals, type FeatureIntervalLink, type VerifiedInterval } from "./aggregate-feature-intervals.js";
import { deriveFeatureAttributions, type CommitEvidence, type Feature } from "./derive-feature-attributions.js";

export function buildFeatureReportData(input: { features: readonly Feature[]; commits: readonly CommitEvidence[]; intervals: readonly VerifiedInterval[]; links: readonly FeatureIntervalLink[] }) {
  return {
    featureAttributions: deriveFeatureAttributions({ features: input.features, commits: input.commits }),
    featureIntervalTotals: aggregateFeatureIntervals({ intervals: input.intervals, links: input.links })
  };
}
