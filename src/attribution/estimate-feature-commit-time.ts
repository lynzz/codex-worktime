export type CommitTimingEvidence = {
  id: string;
  subject: string;
  authoredAt: string;
};

export type FeatureCommitEstimate = {
  featureKey: string;
  featureName: string;
  commitCount: number;
  estimatedMinutes: number;
};

const maximumGapMinutes = 60;

function featureForSubject(subject: string): Pick<FeatureCommitEstimate, "featureKey" | "featureName"> {
  const conventional = /^(?:[a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/iu.exec(subject.trim());
  const scope = conventional?.[1]?.trim();
  if (scope) {
    const featureKey = scope.toLocaleLowerCase();
    return { featureKey, featureName: `${scope}（提交 scope）` };
  }
  const summary = conventional?.[2]?.trim() || subject.trim();
  return { featureKey: `subject:${summary.toLocaleLowerCase()}`, featureName: summary };
}

/**
 * Estimates work only from immediately consecutive commits with the same
 * Conventional Commit scope. It deliberately does not bridge a change of
 * scope or charge time to the first commit in a sequence.
 */
export function estimateFeatureCommitTime(commits: readonly CommitTimingEvidence[]): FeatureCommitEstimate[] {
  const uniqueCommits = new Map<string, CommitTimingEvidence>();
  for (const commit of commits) uniqueCommits.set(commit.id, commit);
  const ordered = [...uniqueCommits.values()].sort((left, right) => left.authoredAt.localeCompare(right.authoredAt));
  const estimates = new Map<string, FeatureCommitEstimate>();
  let previous: { featureKey: string; timestamp: number } | undefined;

  for (const commit of ordered) {
    const timestamp = Date.parse(commit.authoredAt);
    if (Number.isNaN(timestamp)) continue;
    const feature = featureForSubject(commit.subject);
    const estimate = estimates.get(feature.featureKey) ?? {
      ...feature,
      commitCount: 0,
      estimatedMinutes: 0
    };
    estimate.commitCount += 1;
    if (previous?.featureKey === feature.featureKey) {
      const gapMinutes = Math.floor((timestamp - previous.timestamp) / 60_000);
      if (gapMinutes > 0) estimate.estimatedMinutes += Math.min(gapMinutes, maximumGapMinutes);
    }
    estimates.set(feature.featureKey, estimate);
    previous = { featureKey: feature.featureKey, timestamp };
  }

  return [...estimates.values()]
    .filter((estimate) => estimate.estimatedMinutes > 0)
    .sort((left, right) => right.estimatedMinutes - left.estimatedMinutes || right.commitCount - left.commitCount || left.featureName.localeCompare(right.featureName));
}
