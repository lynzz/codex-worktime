import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { Temporal } from "@js-temporal/polyfill";
import { estimatedCostCents, monthPeriod, redactReportText, reportSnapshotSchema, type ReportSnapshot } from "@codex-worktime/report-core";

import type { IntervalCalculation } from "../accounting/calculate-intervals.js";
import { summarizeCommitActivity } from "../attribution/estimate-feature-commit-time.js";
import type { ProjectCommitReportData } from "../attribution/read-project-commit-estimates.js";
import type { CoverageEntry } from "./generate-project-report.js";

export type CursorUndated = ReportSnapshot["cursorUndated"];

export function buildReportSnapshot(input: {
  profile: { id: string; displayName: string; roots: { path: string }[] };
  month: string; generatedAt: string; accounting: IntervalCalculation;
  coverage: readonly CoverageEntry[]; commits: ProjectCommitReportData;
  sourceCounts: { source: string; eventCount: number }[];
  warnings: { reason: string }[]; secrets: readonly string[];
  cursorUndated?: CursorUndated;
  sourceStatus?: Partial<Record<string, "available" | "no-data" | "unknown">>;
  observedDates?: readonly string[];
}): ReportSnapshot {
  const period = monthPeriod(input.month);
  const secrets = [...input.profile.roots.map((root) => root.path), homedir(), ...input.commits.commits.map((commit) => commit.id.trim()), ...input.secrets]
    .filter((value) => value.length >= 3).sort((a, b) => b.length - a.length);
  const safeText = (value: string) => {
    for (const secret of secrets) value = value.replaceAll(secret, "[已脱敏]");
    return redactReportText(value).slice(0, 1000) || "[空标题]";
  };
  const commits = new Map(summarizeCommitActivity(input.commits.commits, period).map((day) => [day.date, day]));
  const active = new Map(input.accounting.active.daily.map((day) => [day.date, Math.round(day.minutes * 60000)]));
  const run = new Map(input.accounting.run.daily.map((day) => [day.date, Math.round(day.minutes * 60000)]));
  const coverage = new Map(input.coverage.map((entry) => [entry.date, entry.status]));
  for (const date of [...(input.observedDates ?? []), ...active.keys(), ...run.keys()]) coverage.set(date, "available");
  const days = Array.from({ length: Temporal.PlainYearMonth.from(period.month).daysInMonth }, (_, i) => {
    const date = Temporal.PlainDate.from(period.from).add({ days: i }).toString();
    const commit = commits.get(date);
    return { date, coverage: coverage.get(date) ?? "unknown", activeMs: active.get(date) ?? null, runMs: run.get(date) ?? null,
      commitCount: commit?.commitCount ?? 0,
      commitMessages: commit?.commitMessages.map((message) => ({ ...message, title: safeText(message.title) })) ?? [],
      commitGroups: commit?.commitGroups.map((group) => ({ label: safeText(group.label), commitCount: group.commitCount, estimatedMs: group.estimatedMs })) ?? [],
      commitEstimateMs: commit?.commitEstimateMs || null
    };
  });
  const intervalTotal = (metric: IntervalCalculation["active"], parallel = false) => metric.intervals.length
    ? Math.round((parallel ? metric.parallelMachineMinutes : metric.wallClockMinutes) * 60000) : null;
  const totalEstimate = days.reduce((sum, day) => sum + (day.commitEstimateMs ?? 0), 0) || null;
  const reasonCounts = new Map<string, number>();
  for (const warning of input.warnings) reasonCounts.set(warning.reason, (reasonCounts.get(warning.reason) ?? 0) + 1);
  const business = {
    schemaVersion: 1, algorithmVersion: "event-union-v1+commit-cadence-ms-v2",
    project: { profileId: input.profile.id, displayName: safeText(input.profile.displayName) }, period,
    rate: { currency: "CNY", dayRateCents: 120000, hoursPerDay: 8 },
    sources: ["fixture", "history", "claude-history", "cursor-history", "hook", "git"].map((source) => {
      const eventCount = source === "git" ? days.reduce((n, day) => n + day.commitCount, 0) : input.sourceCounts.find((entry) => entry.source === source)?.eventCount ?? 0;
      return { source, eventCount, status: source === "git" && !input.commits.available ? "unknown" : input.sourceStatus?.[source] ?? (eventCount ? "available" : "unknown") };
    }),
    cursorUndated: input.cursorUndated ?? { scope: "lifetime-not-monthly", sessionCount: 0, promptCount: 0, completedTurnCount: 0, missingTimestampCount: 0 },
    integrity: [...reasonCounts].sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => ({ reason, count })),
    totals: { activeMs: intervalTotal(input.accounting.active), runMs: intervalTotal(input.accounting.run),
      parallelActiveMs: intervalTotal(input.accounting.active, true), parallelRunMs: intervalTotal(input.accounting.run, true),
      commitEstimateMs: totalEstimate, estimatedCostCents: totalEstimate === null ? null : estimatedCostCents(totalEstimate) }, days
  };
  return reportSnapshotSchema.parse({ ...business, generatedAt: input.generatedAt,
    inputDigest: createHash("sha256").update(JSON.stringify(business)).digest("hex") });
}

/** Free-text input fields never enter the DTO; also redact reappearances in titles. */
export function privateStrings(value: unknown, sensitive = false): string[] {
  if (typeof value === "string") return sensitive ? [value] : [];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const privateField = /^(?:id|cwd|.*(?:prompt|reply|content|arguments|output|key|token|password|secret|sessionId|turnId|toolUseId|agentId|parentSessionId))$/iu.test(key);
    return privateStrings(item, sensitive || privateField);
  });
}
