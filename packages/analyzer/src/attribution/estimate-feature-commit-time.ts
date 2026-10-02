import { Temporal } from "@js-temporal/polyfill";

export type CommitTimingEvidence = { id: string; subject: string; authoredAt: string };

// Legacy API names retained for callers; a commit scope is not a real Feature.
export type FeatureCommitEstimate = { featureKey: string; featureName: string; commitCount: number; estimatedMinutes: number };
export type DailyCommitSummary = { date: string; commitCount: number; summary: string; messages: string[] };
export type DailyCommitEstimate = { date: string; estimatedMinutes: number; summary: string };

function groupForSubject(subject: string) {
  const conventional = /^(?:[a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/iu.exec(subject.trim());
  const scope = conventional?.[1]?.trim();
  const summary = conventional?.[2]?.trim() || subject.trim();
  return scope ? { key: scope.toLowerCase(), label: `${scope}（提交 scope）` }
    : { key: `subject:${summary.toLowerCase()}`, label: summary };
}

/** The single cadence algorithm used by both legacy reports and snapshots. */
export function summarizeCommitActivity(commits: readonly CommitTimingEvidence[], dateRange?: { from: string; to: string }) {
  const ordered = [...new Map(commits.map((commit) => [commit.id.trim(), commit])).values()]
    .filter((commit) => Number.isFinite(Date.parse(commit.authoredAt)))
    .sort((a, b) => Date.parse(a.authoredAt) - Date.parse(b.authoredAt) || a.id.localeCompare(b.id));
  const days = new Map<string, { date: string; commitCount: number; messages: Map<string, number>;
    groups: Map<string, { key: string; label: string; commitCount: number; estimatedMs: number }> }>();
  let previous: { key: string; timestamp: number } | undefined;
  for (const commit of ordered) {
    const timestamp = Date.parse(commit.authoredAt);
    const date = Temporal.Instant.from(commit.authoredAt).toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString();
    const grouping = groupForSubject(commit.subject);
    const day = days.get(date) ?? { date, commitCount: 0, messages: new Map<string, number>(), groups: new Map() };
    day.commitCount += 1;
    const title = commit.subject.trim();
    day.messages.set(title, (day.messages.get(title) ?? 0) + 1);
    const group = day.groups.get(grouping.key) ?? { ...grouping, commitCount: 0, estimatedMs: 0 };
    group.commitCount += 1;
    if (previous?.key === grouping.key) group.estimatedMs += Math.max(0, Math.min(timestamp - previous.timestamp, 3_600_000));
    day.groups.set(grouping.key, group);
    days.set(date, day);
    previous = { key: grouping.key, timestamp };
  }
  return [...days.values()].filter((day) => !dateRange || (day.date >= dateRange.from && day.date <= dateRange.to))
    .sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({
    date: day.date, commitCount: day.commitCount,
    commitMessages: [...day.messages].map(([title, count]) => ({ title, count })),
    commitGroups: [...day.groups.values()].sort((a, b) => a.label.localeCompare(b.label)),
    commitEstimateMs: [...day.groups.values()].reduce((sum, group) => sum + group.estimatedMs, 0)
  }));
}

function topGroupSummary(values: string[]) {
  return `${values.slice(0, 3).join(" · ")}${values.length > 3 ? ` · 等 ${values.length - 3} 项` : ""}`;
}

export function summarizeCommitsByDay(commits: readonly CommitTimingEvidence[], dateRange?: { from: string; to: string }): DailyCommitSummary[] {
  return summarizeCommitActivity(commits, dateRange).map((day) => ({
    date: day.date, commitCount: day.commitCount,
    summary: topGroupSummary([...day.commitGroups].sort((a, b) => b.commitCount - a.commitCount || a.label.localeCompare(b.label))
      .map((group) => `${group.label} × ${group.commitCount}`)),
    messages: day.commitMessages.map((message) => message.count > 1 ? `${message.title} × ${message.count}` : message.title)
  }));
}

export function summarizeEstimatedCommitTimeByDay(commits: readonly CommitTimingEvidence[], dateRange?: { from: string; to: string }): DailyCommitEstimate[] {
  return summarizeCommitActivity(commits, dateRange).filter((day) => day.commitEstimateMs > 0).map((day) => ({
    date: day.date, estimatedMinutes: day.commitEstimateMs / 60000,
    summary: topGroupSummary(day.commitGroups.filter((group) => group.estimatedMs > 0)
      .sort((a, b) => b.estimatedMs - a.estimatedMs || a.label.localeCompare(b.label))
      .map((group) => `${group.label} × ${(group.estimatedMs / 3600000).toFixed(2)} 小时`))
  }));
}

export function estimateFeatureCommitTime(commits: readonly CommitTimingEvidence[], dateRange?: { from: string; to: string }): FeatureCommitEstimate[] {
  const groups = new Map<string, FeatureCommitEstimate>();
  for (const day of summarizeCommitActivity(commits, dateRange)) {
    for (const group of day.commitGroups) {
      const value = groups.get(group.key) ?? { featureKey: group.key, featureName: group.label, commitCount: 0, estimatedMinutes: 0 };
      value.commitCount += group.commitCount;
      value.estimatedMinutes += group.estimatedMs / 60000;
      groups.set(group.key, value);
    }
  }
  return [...groups.values()].filter((group) => group.estimatedMinutes > 0)
    .sort((a, b) => b.estimatedMinutes - a.estimatedMinutes || b.commitCount - a.commitCount || a.featureName.localeCompare(b.featureName));
}
