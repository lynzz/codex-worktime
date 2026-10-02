import { Temporal } from "@js-temporal/polyfill";
import { hoursLabel, reportSnapshotSchema, type ReportSnapshot } from "@codex-worktime/report-core";
import nunjucks from "nunjucks";
import { reportTemplate } from "./report-template.js";

const coverageLabels = { available: "可用", "no-data": "无数据（不代表零工时）", unknown: "未知（不主张工时）" };
const sourceLabels = { fixture: "测试数据", history: "Codex", "claude-history": "Claude Code", "cursor-history": "Cursor", hook: "Codex Hook", git: "Git 提交" };
const metricLabel = (value: number | null) => value === null ? "—（无法确认）" : hoursLabel(value);

/** Rendering only reads the validated snapshot, never SQLite, Git or histories. */
export function renderReportSnapshot(value: ReportSnapshot, view: "internal" | "customer" = "internal"): string {
  const snapshot = reportSnapshotSchema.parse(value);
  const { totals } = snapshot;
  const weeks = new Map<string, number>();
  for (const day of snapshot.days) {
    if (day.activeMs === null) continue;
    const date = Temporal.PlainDate.from(day.date);
    const week = `${date.yearOfWeek}-W${String(date.weekOfYear).padStart(2, "0")}`;
    weeks.set(week, (weeks.get(week) ?? 0) + day.activeMs);
  }
  const eventCount = snapshot.sources.filter((source) => source.source !== "git").reduce((sum, source) => sum + source.eventCount, 0);
  const coverageSummary = { available: 0, unknown: 0, noData: 0 };
  for (const day of snapshot.days) coverageSummary[day.coverage === "no-data" ? "noData" : day.coverage] += 1;
  const cursor = snapshot.cursorUndated;
  return nunjucks.renderString(reportTemplate, {
    displayName: snapshot.project.displayName, view, viewLabel: view === "internal" ? "内部报告" : "客户报告",
    summary: view === "customer" ? "客户视图仅包含已批准的汇总报告字段。" : `${eventCount} 条脱敏事件匹配此 Project Profile。`,
    statusLabel: eventCount || totals.activeMs !== null || totals.runMs !== null ? "数据可用" : "无可确认数据",
    dateRangeLabel: `${snapshot.period.from} 至 ${snapshot.period.to}`, coverageSummary,
    activeTotalLabel: metricLabel(totals.activeMs), runTotalLabel: metricLabel(totals.runMs), parallelActiveLabel: metricLabel(totals.parallelActiveMs),
    sourceSummary: snapshot.sources.map((source) => `${sourceLabels[source.source]} ${source.eventCount} 条（${coverageLabels[source.status]}）`).join(" · "),
    cursorUndatedLabel: `${cursor.sessionCount} 个会话 · ${cursor.promptCount} 次提问 · ${cursor.completedTurnCount} 个完成回合 · ${cursor.missingTimestampCount} 条无时间戳记录`,
    accounting: { active: { weekly: [...weeks].map(([week, milliseconds]) => ({ week, minutes: hoursLabel(milliseconds) })) } },
    weeklyUnit: "小时", warnings: snapshot.integrity.map((warning) => ({ reason: `${warning.reason} × ${warning.count}` })),
    featureRows: [], commitEstimateTotalMinutes: totals.commitEstimateMs === null ? null : totals.commitEstimateMs / 60000,
    commitEstimateTotalHours: ((totals.commitEstimateMs ?? 0) / 3600000).toFixed(2),
    commitEstimateTotalDays: ((totals.commitEstimateMs ?? 0) / (8 * 3600000)).toFixed(2),
    commitEstimateTotalCost: `¥${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((totals.estimatedCostCents ?? 0) / 100)}`,
    dailyRows: snapshot.days.map((day) => ({ date: day.date, activeLabel: metricLabel(day.activeMs),
      commitCount: day.commitCount, commitSummary: day.commitGroups.map((group) => `${group.label} × ${group.commitCount}`).join(" · "),
      commitMessages: day.commitMessages.map((message) => message.count > 1 ? `${message.title} × ${message.count}` : message.title),
      commitEstimateMinutes: day.commitEstimateMs === null ? null : day.commitEstimateMs / 60000,
      commitEstimateHours: ((day.commitEstimateMs ?? 0) / 3600000).toFixed(2),
      commitEstimateSummary: day.commitGroups.filter((group) => group.estimatedMs > 0).map((group) => `${group.label} × ${hoursLabel(group.estimatedMs)}`).join(" · "),
      coverageLabel: coverageLabels[day.coverage]
    }))
  });
}
