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

export type DailyCommitSummary = {
  date: string;
  commitCount: number;
  summary: string;
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

function uniqueCommits(commits: readonly CommitTimingEvidence[]): CommitTimingEvidence[] {
  return [...new Map(commits.map((commit) => [commit.id, commit])).values()];
}

export function summarizeCommitsByDay(commits: readonly CommitTimingEvidence[]): DailyCommitSummary[] {
  const days = new Map<string, Map<string, { name: string; count: number }>>();
  for (const commit of uniqueCommits(commits)) {
    let date: string;
    try {
      date = Temporal.Instant.from(commit.authoredAt).toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString();
    } catch {
      continue;
    }
    const feature = featureForSubject(commit.subject);
    const features = days.get(date) ?? new Map();
    const value = features.get(feature.featureKey) ?? { name: feature.featureName, count: 0 };
    value.count += 1;
    features.set(feature.featureKey, value);
    days.set(date, features);
  }
  return [...days.entries()]
    .map(([date, features]) => {
      const grouped = [...features.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
      const commitCount = grouped.reduce((count, feature) => count + feature.count, 0);
      const displayed = grouped.slice(0, 3).map((feature) => `${feature.name} × ${feature.count}`);
      const remainingCount = grouped.length - displayed.length;
      return { date, commitCount, summary: `${displayed.join(" · ")}${remainingCount ? ` · 等 ${remainingCount} 项` : ""}` };
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Estimates work only from immediately consecutive commits with the same
 * Conventional Commit scope. It deliberately does not bridge a change of
 * scope or charge time to the first commit in a sequence.
 */
export function estimateFeatureCommitTime(commits: readonly CommitTimingEvidence[]): FeatureCommitEstimate[] {
  const ordered = uniqueCommits(commits).sort((left, right) => left.authoredAt.localeCompare(right.authoredAt));
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
import { Temporal } from "@js-temporal/polyfill";
