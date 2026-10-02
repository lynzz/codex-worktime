import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const reportMonthSchema = z.string().regex(/^\d{4}-\d{2}$/).refine((value) => {
  try { Temporal.PlainYearMonth.from(value); return true; } catch { return false; }
}, "Invalid report month");

export function monthPeriod(month: string) {
  const value = Temporal.PlainYearMonth.from(reportMonthSchema.parse(month));
  return { month, from: value.toPlainDate({ day: 1 }).toString(), to: value.toPlainDate({ day: value.daysInMonth }).toString(), timeZone: "Asia/Shanghai" as const };
}

// Strict at every level: the cloud-facing contract cannot retain unknown data.
const count = z.number().int().nonnegative().safe();
const duration = count.nullable();
const coverage = z.enum(["available", "no-data", "unknown"]);
const sensitiveTextPattern = /(?:[a-z]:[\\/]|(?:^|(?<=[\s("'=:]))\/|file:\/|~\/)[^\s<>"']+|(?:sk-[\w-]{6,}|gh[pousr]_[\w]+|github_pat_[\w]+|Bearer\s+\S+|(?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*\S+|https?:\/\/[^\s/@:]+:[^\s/@]+@)/iu;
export function redactReportText(value: string): string {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Ordinary percent signs are allowed. */ }
  decoded = decoded.replaceAll("\\/", "/");
  return sensitiveTextPattern.test(decoded) ? "[敏感文本已脱敏]" : value;
}
const text = z.string().min(1).max(1000).refine((value) => redactReportText(value) === value, "Sensitive report text is not allowed");
const sourceName = z.enum(["fixture", "history", "claude-history", "cursor-history", "hook", "git"]);
export const reportSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  algorithmVersion: z.literal("event-union-v1+commit-cadence-ms-v2"),
  generatedAt: z.iso.datetime(),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  project: z.object({ profileId: z.string().regex(/^[a-z][a-z0-9_-]*$/), displayName: text }).strict(),
  period: z.object({ month: reportMonthSchema, from: z.iso.date(), to: z.iso.date(), timeZone: z.literal("Asia/Shanghai") }).strict(),
  rate: z.object({ currency: z.literal("CNY"), dayRateCents: count, hoursPerDay: z.literal(8) }).strict(),
  sources: z.array(z.object({ source: sourceName, eventCount: count, status: coverage }).strict()),
  cursorUndated: z.object({ scope: z.literal("lifetime-not-monthly"), sessionCount: count, promptCount: count, completedTurnCount: count, missingTimestampCount: count }).strict(),
  integrity: z.array(z.object({ reason: z.enum(["invalid-timestamp", "missing-turn-stop", "missing-tool-post", "unmatched-tool-post", "out-of-order-tool-event", "negative-tool-interval", "out-of-order-turn-event"]), count }).strict()),
  totals: z.object({ activeMs: duration, runMs: duration, parallelActiveMs: duration, parallelRunMs: duration,
    commitEstimateMs: duration, estimatedCostCents: duration }).strict(),
  weekly: z.array(z.object({ week: z.string().regex(/^\d{4}-W\d{2}$/), activeMs: duration, runMs: duration }).strict()),
  featureAttributions: z.array(z.object({
    featureId: text, featureName: text,
    evidence: z.enum(["explicit-ticket", "planning-reference", "branch", "merge-subject", "commit-subject", "path", "semantic"]),
    confidence: z.enum(["high", "medium", "low"]), suggested: z.boolean()
  }).strict().refine((value) => value.confidence !== "low" || value.suggested, "Low confidence must remain a suggestion")),
  featureIntervalTotals: z.array(z.object({ featureId: text, activeMs: count, runMs: count, evidenceCount: count.positive() }).strict()),
  featureTotalsUnavailableForRange: z.boolean(),
  days: z.array(z.object({ date: z.iso.date(), coverage, activeMs: duration, runMs: duration,
    commitCount: count,
    commitMessages: z.array(z.object({ title: text, count: count }).strict()),
    commitGroups: z.array(z.object({ label: text, commitCount: count, estimatedMs: count }).strict()),
    commitEstimateMs: duration
  }).strict())
}).strict().superRefine((snapshot, ctx) => {
  // Field errors must remain validation results, not exceptions in Temporal or BigInt.
  if (ctx.issues.length) return;
  const period = monthPeriod(snapshot.period.month);
  if (period.from !== snapshot.period.from || period.to !== snapshot.period.to) ctx.addIssue({ code: "custom", message: "Period must cover the full Shanghai month" });
  const dates = snapshot.days.map((day) => day.date);
  const expected = Temporal.PlainYearMonth.from(period.month).daysInMonth;
  if (dates.length !== expected || dates.some((date, i) => date !== Temporal.PlainDate.from(period.from).add({ days: i }).toString())) {
    ctx.addIssue({ code: "custom", message: "Daily rows must cover the month exactly once, in date order" });
  }
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const day of snapshot.days) {
    if (day.commitMessages.some((message) => message.count === 0) || day.commitGroups.some((group) => group.commitCount === 0)) issue("Commit groups and messages must have positive counts");
    if (day.commitMessages.reduce((n, message) => n + message.count, 0) !== day.commitCount || day.commitGroups.reduce((n, group) => n + group.commitCount, 0) !== day.commitCount) issue("Commit counts must agree");
    const estimate = day.commitGroups.reduce((n, group) => n + group.estimatedMs, 0) || null;
    if (estimate !== day.commitEstimateMs) issue("Daily estimate must agree with groups");
  }
  const sum = (key: "activeMs" | "runMs" | "commitEstimateMs") => snapshot.days.some((day) => day[key] !== null)
    ? snapshot.days.reduce((n, day) => n + (day[key] ?? 0), 0) : null;
  for (const key of ["activeMs", "runMs", "commitEstimateMs"] as const) if (sum(key) !== snapshot.totals[key]) issue("Totals must agree with daily durations");
  const estimate = snapshot.totals.commitEstimateMs;
  if ((estimate === null ? null : estimatedCostCents(estimate, snapshot.rate.dayRateCents)) !== snapshot.totals.estimatedCostCents) issue("Cost must be rounded once from exact duration");
  if (new Set(snapshot.sources.map((source) => source.source)).size !== snapshot.sources.length) issue("Sources must be unique");
  const weeks = new Map<string, { activeMs: number | null; runMs: number | null }>();
  for (const day of snapshot.days) {
    const date = Temporal.PlainDate.from(day.date);
    const week = `${date.yearOfWeek}-W${String(date.weekOfYear).padStart(2, "0")}`;
    const total = weeks.get(week) ?? { activeMs: null, runMs: null };
    for (const key of ["activeMs", "runMs"] as const) if (day[key] !== null) total[key] = (total[key] ?? 0) + day[key];
    weeks.set(week, total);
  }
  const expectedWeeks = [...weeks.entries()];
  if (snapshot.weekly.length !== expectedWeeks.length || snapshot.weekly.some((week, index) => {
    const expected = expectedWeeks[index];
    return !expected || week.week !== expected[0] || week.activeMs !== expected[1].activeMs || week.runMs !== expected[1].runMs;
  })) issue("Saved weekly durations must agree with daily intervals");
  if (new Set(snapshot.featureIntervalTotals.map((total) => total.featureId)).size !== snapshot.featureIntervalTotals.length) issue("Feature totals must be unique");
});

export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;
export const hoursLabel = (milliseconds: number) => `${(milliseconds / 3_600_000).toFixed(2)} 小时`;
export const estimatedCostCents = (milliseconds: number, dayRateCents = 120000) => {
  const denominator = 8n * 3_600_000n;
  return Number((BigInt(milliseconds) * BigInt(dayRateCents) + denominator / 2n) / denominator);
};

/** Sorted object keys give field-order-independent content identity; array order is contractual. */
export function reportBusinessJson(value: ReportSnapshot): string {
  const { generatedAt: _generatedAt, inputDigest: _inputDigest, ...business } = reportSnapshotSchema.parse(value);
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === "object") return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonical(child)])
    );
    return item;
  };
  return JSON.stringify(canonical(business));
}

export async function calculateReportDigest(value: ReportSnapshot): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reportBusinessJson(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export { renderReportSnapshot } from "./render-report-snapshot.js";
