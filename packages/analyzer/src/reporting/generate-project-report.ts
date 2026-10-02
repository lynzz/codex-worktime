import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import Database from "better-sqlite3";
import nunjucks from "nunjucks";
import { z } from "zod";
import { monthPeriod } from "@codex-worktime/report-core";
import { buildReportSnapshot, privateStrings, type CursorUndated } from "./build-report-snapshot.js";
import { reportTemplate } from "./report-template.js";
import { renderReportSnapshot } from "./render-report-snapshot.js";

import { calculateIntervals, type IntervalCalculation, type ReportingDateRange } from "../accounting/calculate-intervals.js";
import { readProjectCommitReportData } from "../attribution/read-project-commit-estimates.js";
import type { DailyCommitEstimate, DailyCommitSummary, FeatureCommitEstimate } from "../attribution/estimate-feature-commit-time.js";

const safeIdentifierSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/);
let temporaryOutputSequence = 0;
let pendingInProcessRefresh = Promise.resolve();

export const projectProfileSchema = z.object({
  id: safeIdentifierSchema,
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => !value.includes("/") && !value.includes("\\"), "Display name must not contain a path"),
  roots: z
    .array(
      z.object({
        id: safeIdentifierSchema,
        path: z.string().min(1)
      })
    )
    .min(1)
});

const eventSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().min(1),
  type: z.enum([
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "Stop",
    "SessionEnd",
    "SubagentStart",
    "SubagentStop"
  ]),
  cwd: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  toolUseId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  parentSessionId: z.string().min(1).optional(),
  source: z.enum(["fixture", "history", "claude-history", "cursor-history", "hook"]).default("fixture")
});

const coverageEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["available", "no-data", "unknown"])
});

const reportingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
}, "Invalid reporting date");
const dateRangeSchema = z.object({ from: reportingDateSchema, to: reportingDateSchema }).refine(
  (range) => range.from <= range.to,
  "Reporting date range must end on or after its start date"
);

const featureAttributionSchema = z.object({
  featureId: safeIdentifierSchema,
  featureName: z.string().trim().min(1).max(120),
  commitId: z.string().min(1),
  evidence: z.enum(["explicit-ticket", "planning-reference", "branch", "merge-subject", "commit-subject", "path", "semantic"]),
  confidence: z.enum(["high", "medium", "low"]),
  suggested: z.boolean()
}).refine((value) => value.confidence !== "low" || value.suggested, "Low-confidence attribution must be a suggestion");
const featureIntervalTotalSchema = z.object({
  featureId: safeIdentifierSchema,
  activeMinutes: z.number().nonnegative(),
  runMinutes: z.number().nonnegative(),
  evidenceCount: z.number().int().positive(),
  dateRange: dateRangeSchema.optional()
});

const inputSchema = z.object({
  profile: projectProfileSchema,
  events: z.array(eventSchema),
  coverage: z.array(coverageEntrySchema).default([]),
  featureAttributions: z.array(featureAttributionSchema).default([]),
  featureIntervalTotals: z.array(featureIntervalTotalSchema).default([]),
  sourceNotes: z.array(z.string().trim().min(1).max(240)).default([]),
  view: z.enum(["internal", "customer"]).default("internal"),
  dateRange: dateRangeSchema.optional(),
  databasePath: z.string().min(1),
  htmlPath: z.string().min(1)
});

export type GenerateProjectReportInput = {
  month?: string;
  jsonPath?: string;
  generatedAt?: string;
  cursorUndated?: CursorUndated;
  sourceStatus?: Partial<Record<string, "available" | "no-data" | "unknown">>;
  profile: unknown;
  events: unknown;
  coverage?: unknown;
  featureAttributions?: unknown;
  featureIntervalTotals?: unknown;
  sourceNotes?: unknown;
  view?: "internal" | "customer";
  dateRange?: ReportingDateRange;
  databasePath: string;
  htmlPath: string;
  applicationDataDirectory?: string;
};

export type ProjectReportResult = {
  matchedEventCount: number;
  coverage: "available" | "no-data" | "unknown";
  htmlPath: string;
};

export type CoverageEntry = z.output<typeof coverageEntrySchema>;

type Root = z.output<typeof projectProfileSchema>["roots"][number];

type StoredEvent = {
  sequence: number;
  eventHash: string;
  rootId: string;
  occurredAt: string;
  eventType: string;
  sessionHash: string | null;
  turnHash: string | null;
  toolUseHash: string | null;
  agentHash: string | null;
  lineageHash: string | null;
  source: "fixture" | "history" | "claude-history" | "cursor-history" | "hook";
};

type EventNormalization = {
  events: StoredEvent[];
  warnings: DataQualityWarning[];
};

type DataQualityWarning = {
  eventHash: string;
  reason: "invalid-timestamp" | "missing-turn-stop" | "missing-tool-post" | "unmatched-tool-post" | "out-of-order-tool-event" | "negative-tool-interval" | "out-of-order-turn-event";
};


function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function matchingRoot(cwd: string, roots: readonly Root[]): Root | undefined {
  const normalizedCwd = resolve(cwd);
  return roots
    .map((root) => ({ root, normalizedPath: resolve(root.path) }))
    .filter(({ normalizedPath }) => normalizedCwd === normalizedPath || normalizedCwd.startsWith(`${normalizedPath}/`))
    .sort((left, right) => right.normalizedPath.length - left.normalizedPath.length)[0]?.root;
}

function normalizeMatchingEvents(
  events: z.output<typeof eventSchema>[],
  roots: readonly Root[]
): EventNormalization {
  const normalizedEvents: StoredEvent[] = [];
  const seenEventHashes = new Set<string>();
  const warnings: DataQualityWarning[] = [];
  const warningKeys = new Set<string>();
  const addWarning = (eventHash: string, reason: DataQualityWarning["reason"]): void => {
    const key = `${eventHash}:${reason}`;
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push({ eventHash, reason });
    }
  };

  for (const [sequence, event] of events.entries()) {
    const root = matchingRoot(event.cwd, roots);
    if (!root) {
      continue;
    }

    const eventHash = hashIdentifier(event.id);
    if (seenEventHashes.has(eventHash)) {
      continue;
    }
    seenEventHashes.add(eventHash);

    try {
      normalizedEvents.push({
        sequence,
        eventHash,
        rootId: root.id,
        occurredAt: Temporal.Instant.from(event.occurredAt).toString(),
        eventType: event.type,
        sessionHash: event.sessionId ? hashIdentifier(event.sessionId) : null,
        turnHash: event.turnId ? hashIdentifier(event.turnId) : null,
        toolUseHash: event.toolUseId ? hashIdentifier(event.toolUseId) : null,
        agentHash: event.agentId ? hashIdentifier(event.agentId) : null,
        lineageHash: event.parentSessionId ? hashIdentifier(event.parentSessionId) : null,
        source: event.source
      });
    } catch {
      addWarning(eventHash, "invalid-timestamp");
    }
  }

  return { events: normalizedEvents, warnings };
}

function calculateSequenceWarnings(events: readonly StoredEvent[]): DataQualityWarning[] {
  const warnings: DataQualityWarning[] = [];
  const warningKeys = new Set<string>();
  const addWarning = (eventHash: string, reason: DataQualityWarning["reason"]): void => {
    const key = `${eventHash}:${reason}`;
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push({ eventHash, reason });
    }
  };
  const eventsBySequence = new Map<string, StoredEvent[]>();
  for (const event of events) {
    const sequenceKey = event.sessionHash ?? event.turnHash ?? event.eventHash;
    const sequenceEvents = eventsBySequence.get(sequenceKey) ?? [];
    sequenceEvents.push(event);
    eventsBySequence.set(sequenceKey, sequenceEvents);
  }

  for (const sequenceEvents of eventsBySequence.values()) {
    const orderedEvents = [...sequenceEvents].sort(
      (left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.sequence - right.sequence
    );
    let openTurn: StoredEvent | undefined;
    const openToolRunsById = new Map<string, StoredEvent>();
    const openToolRunsWithoutId: StoredEvent[] = [];

    for (const event of orderedEvents) {
      if (event.eventType === "UserPromptSubmit") {
        if (openTurn) {
          addWarning(openTurn.eventHash, "missing-turn-stop");
        }
        openTurn = event;
      } else if (event.eventType === "Stop") {
        openTurn = undefined;
      } else if (event.eventType === "PreToolUse") {
        if (event.toolUseHash) {
          openToolRunsById.set(event.toolUseHash, event);
        } else {
          openToolRunsWithoutId.push(event);
        }
      } else if (event.eventType === "PostToolUse") {
        const matchingRun = event.toolUseHash
          ? openToolRunsById.get(event.toolUseHash)
          : openToolRunsWithoutId.shift();
        if (matchingRun === undefined) {
          addWarning(event.eventHash, "unmatched-tool-post");
        } else if (event.toolUseHash) {
          openToolRunsById.delete(event.toolUseHash);
        }
      }
    }

    if (openTurn) {
      addWarning(openTurn.eventHash, "missing-turn-stop");
    }
    for (const event of [...openToolRunsById.values(), ...openToolRunsWithoutId]) {
      addWarning(event.eventHash, "missing-tool-post");
    }
  }

  return warnings;
}

function isWithinDirectory(path: string, directory: string): boolean {
  const difference = relative(directory, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function applicationDataDirectory(): string {
  if (process.env.CODEX_WORKTIME_DATA_DIR) {
    return resolve(process.env.CODEX_WORKTIME_DATA_DIR);
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "codex-worktime");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "codex-worktime");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "codex-worktime");
}

function ensureStorageOutsideProjectRoots(
  databasePath: string,
  dataDirectory: string,
  roots: readonly Root[]
): void {
  const resolvedDatabasePath = resolve(databasePath);
  if (!isWithinDirectory(resolvedDatabasePath, dataDirectory)) {
    throw new Error("Analytics storage must be inside the user application-data directory");
  }
  if (roots.some((root) => isWithinDirectory(resolvedDatabasePath, resolve(root.path)))) {
    throw new Error("Analytics storage must be outside configured project roots");
  }
}

async function serializeInProcessRefresh<T>(operation: () => Promise<T>): Promise<T> {
  const previousRefresh = pendingInProcessRefresh;
  let releaseCurrentRefresh: () => void = () => undefined;
  pendingInProcessRefresh = new Promise<void>((resolveRefresh) => {
    releaseCurrentRefresh = resolveRefresh;
  });
  await previousRefresh;
  try {
    return await operation();
  } finally {
    releaseCurrentRefresh();
  }
}

function openEventStore(databasePath: string): Database.Database {
  const database = new Database(databasePath);
  database.pragma("busy_timeout = 5000");
  return database;
}

function initializeEventStore(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS events (
      event_hash TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      root_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      session_hash TEXT,
      turn_hash TEXT,
      tool_use_hash TEXT,
      agent_hash TEXT,
      lineage_hash TEXT,
      source TEXT NOT NULL DEFAULT 'fixture'
    )
    ;
    CREATE TABLE IF NOT EXISTS data_quality_warnings (
      event_hash TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      PRIMARY KEY (event_hash, reason)
    )
    ;
    CREATE TABLE IF NOT EXISTS coverage (
      project_id TEXT NOT NULL,
      report_date TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (project_id, report_date)
    )
  `);
  const columns = database.prepare("PRAGMA table_info(events)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "lineage_hash")) {
    database.exec("ALTER TABLE events ADD COLUMN lineage_hash TEXT");
  }
  if (!columns.some((column) => column.name === "tool_use_hash")) {
    database.exec("ALTER TABLE events ADD COLUMN tool_use_hash TEXT");
  }
  if (!columns.some((column) => column.name === "agent_hash")) {
    database.exec("ALTER TABLE events ADD COLUMN agent_hash TEXT");
  }
  if (!columns.some((column) => column.name === "source")) {
    database.exec("ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'fixture'");
  }
  const warningColumns = database.prepare("PRAGMA table_info(data_quality_warnings)").all() as { name: string }[];
  if (!warningColumns.some((column) => column.name === "project_id")) {
    database.exec("ALTER TABLE data_quality_warnings ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
    database.exec(`
      UPDATE data_quality_warnings
      SET project_id = COALESCE((SELECT project_id FROM events WHERE events.event_hash = data_quality_warnings.event_hash), 'legacy-unscoped')
      WHERE project_id = ''
    `);
  }
}

function storeEvents(
  database: Database.Database,
  projectId: string,
  events: readonly StoredEvent[],
  warnings: readonly DataQualityWarning[],
  coverage: readonly CoverageEntry[]
): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO events (
      event_hash, project_id, root_id, occurred_at, event_type, session_hash, turn_hash, tool_use_hash, agent_hash, lineage_hash, source
    ) VALUES (
      @eventHash, @projectId, @rootId, @occurredAt, @eventType, @sessionHash, @turnHash, @toolUseHash, @agentHash, @lineageHash, @source
    )
  `);

  const insertAll = database.transaction((items: readonly StoredEvent[]) => {
    for (const event of items) {
      insert.run({ ...event, projectId });
    }
  });
  insertAll(events);

  const insertWarning = database.prepare(`
    INSERT OR IGNORE INTO data_quality_warnings (event_hash, project_id, reason) VALUES (@eventHash, @projectId, @reason)
  `);
  const insertWarnings = database.transaction((items: readonly DataQualityWarning[]) => {
    for (const warning of items) {
      insertWarning.run({ ...warning, projectId });
    }
  });
  insertWarnings(warnings);

  const insertCoverage = database.prepare(`
    INSERT INTO coverage (project_id, report_date, status) VALUES (@projectId, @date, @status)
    ON CONFLICT(project_id, report_date) DO UPDATE SET status = excluded.status
  `);
  const insertCoverageEntries = database.transaction((items: readonly CoverageEntry[]) => {
    for (const entry of items) {
      insertCoverage.run({ ...entry, projectId });
    }
  });
  insertCoverageEntries(coverage);
}

function readStoredEvents(database: Database.Database, projectId: string): StoredEvent[] {
  return database
    .prepare(`
      SELECT rowid AS sequence, event_hash AS eventHash, root_id AS rootId, occurred_at AS occurredAt,
        event_type AS eventType, session_hash AS sessionHash, turn_hash AS turnHash,
        tool_use_hash AS toolUseHash, agent_hash AS agentHash, lineage_hash AS lineageHash, source
      FROM events WHERE project_id = ? ORDER BY rowid
    `)
    .all(projectId) as StoredEvent[];
}

function replaceSequenceWarnings(
  database: Database.Database,
  projectId: string,
  warnings: readonly DataQualityWarning[]
): void {
  database
    .prepare(`
      DELETE FROM data_quality_warnings
      WHERE reason IN ('missing-turn-stop', 'missing-tool-post', 'unmatched-tool-post', 'out-of-order-tool-event', 'negative-tool-interval', 'out-of-order-turn-event')
        AND project_id = ?
    `)
    .run(projectId);
  const insertWarning = database.prepare(`
    INSERT OR IGNORE INTO data_quality_warnings (event_hash, project_id, reason) VALUES (@eventHash, @projectId, @reason)
  `);
  const insertAll = database.transaction((items: readonly DataQualityWarning[]) => {
    for (const warning of items) {
      insertWarning.run({ ...warning, projectId });
    }
  });
  insertAll(warnings);
}

function readPersistedInvalidTimestampWarnings(
  database: Database.Database,
  projectId: string
): DataQualityWarning[] {
  return database
    .prepare(`
      SELECT event_hash AS eventHash, reason FROM data_quality_warnings
      WHERE project_id = ? AND reason = 'invalid-timestamp'
    `)
    .all(projectId) as DataQualityWarning[];
}

function countLegacyUnscopedWarnings(database: Database.Database): number {
  return (
    database
      .prepare("SELECT COUNT(*) AS count FROM data_quality_warnings WHERE project_id = 'legacy-unscoped'")
      .get() as { count: number }
  ).count;
}

function renderReport(
  displayName: string,
  matchedEventCount: number,
  warnings: readonly DataQualityWarning[],
  coverage: readonly CoverageEntry[],
  legacyUnscopedWarningCount: number,
  accounting: IntervalCalculation,
  featureAttributions: readonly z.output<typeof featureAttributionSchema>[],
  featureIntervalTotals: readonly z.output<typeof featureIntervalTotalSchema>[],
  commitEstimates: readonly FeatureCommitEstimate[],
  dailyCommitSummaries: readonly DailyCommitSummary[],
  dailyCommitEstimates: readonly DailyCommitEstimate[],
  sourceCounts: readonly { source: StoredEvent["source"]; eventCount: number }[],
  sourceNotes: readonly string[],
  view: "internal" | "customer",
  dateRange: ReportingDateRange | undefined
): string {
  const hasData = matchedEventCount > 0 || accounting.active.wallClockMinutes > 0 || accounting.run.wallClockMinutes > 0;
  const namesByFeatureId = new Map(featureAttributions.map((attribution) => [attribution.featureId, attribution.featureName]));
  const visibleCoverage = coverage.filter((entry) => !dateRange || (entry.date >= dateRange.from && entry.date <= dateRange.to));
  const coverageSummary = visibleCoverage.reduce(
    (summary, entry) => ({
      ...summary,
      available: summary.available + Number(entry.status === "available"),
      unknown: summary.unknown + Number(entry.status === "unknown"),
      noData: summary.noData + Number(entry.status === "no-data")
    }),
    { available: 0, unknown: 0, noData: 0 }
  );
  const commitEstimateTotalMinutes = commitEstimates.reduce((total, estimate) => total + estimate.estimatedMinutes, 0);
  const commitEstimateTotalHours = commitEstimateTotalMinutes / 60;
  const commitEstimateTotalDays = commitEstimateTotalHours / 8;
  const commitEstimateTotalCost = commitEstimateTotalDays * 1200;
  const sourceLabels: Record<StoredEvent["source"], string> = {
    fixture: "测试数据",
    history: "Codex",
    "claude-history": "Claude Code",
    "cursor-history": "Cursor",
    hook: "Codex Hook"
  };
  const dailyRows = new Map<string, { date: string; activeLabel: string; commitCount?: number; commitSummary?: string; commitMessages?: string[]; commitEstimateMinutes?: number; commitEstimateSummary?: string; coverageLabel?: string }>();
  for (const entry of accounting.active.daily) dailyRows.set(entry.date, { date: entry.date, activeLabel: `${(entry.minutes / 60).toFixed(2)} 小时` });
  for (const entry of dailyCommitSummaries) {
    const existing = dailyRows.get(entry.date);
    dailyRows.set(entry.date, {
      date: entry.date,
      activeLabel: existing?.activeLabel ?? "—",
      commitCount: entry.commitCount,
      commitSummary: entry.summary,
      commitMessages: entry.messages
    });
  }
  for (const entry of dailyCommitEstimates) {
    const existing = dailyRows.get(entry.date);
    dailyRows.set(entry.date, {
      date: entry.date,
      activeLabel: existing?.activeLabel ?? "—",
      commitCount: existing?.commitCount,
      commitSummary: existing?.commitSummary,
      commitMessages: existing?.commitMessages,
      commitEstimateMinutes: entry.estimatedMinutes,
      commitEstimateSummary: entry.summary,
      coverageLabel: existing?.coverageLabel
    });
  }
  const renderedCoverage = visibleCoverage.map((entry) => ({
    ...entry,
    label: entry.status === "no-data" ? "无数据（不代表零工时）" : entry.status === "unknown" ? "未知（不主张工时）" : "可用"
  }));
  for (const entry of renderedCoverage) {
    const existing = dailyRows.get(entry.date);
    dailyRows.set(entry.date, {
      date: entry.date,
      activeLabel: existing?.activeLabel ?? "—",
      commitCount: existing?.commitCount,
      commitSummary: existing?.commitSummary,
      commitMessages: existing?.commitMessages,
      commitEstimateMinutes: existing?.commitEstimateMinutes,
      commitEstimateSummary: existing?.commitEstimateSummary,
      coverageLabel: entry.label
    });
  }
  const visibleFeatureTotals = featureIntervalTotals
    .filter((total) => !dateRange || (total.dateRange?.from === dateRange.from && total.dateRange.to === dateRange.to))
    .filter((total) => view === "internal" || namesByFeatureId.has(total.featureId));
  const totalsByFeatureId = new Map(visibleFeatureTotals.map((total) => [total.featureId, total]));
  const featureRows = new Map<string, {
    name: string;
    evidence: string;
    confidence: "high" | "medium" | "low";
    confidenceLabel: string;
    suggested: boolean;
    commitId?: string;
    activeLabel: string;
    runLabel: string;
    evidenceCount: string;
  }>();
  const confidenceRank = { high: 3, medium: 2, low: 1 } as const;
  const confidenceLabels = { high: "高", medium: "中", low: "低" } as const;
  const evidenceLabels = {
    "explicit-ticket": "明确票据",
    "planning-reference": "规划文档",
    branch: "分支",
    "merge-subject": "合并提交主题",
    "commit-subject": "提交主题",
    path: "改动路径",
    semantic: "语义推断"
  } as const;
  for (const attribution of featureAttributions) {
    const existing = featureRows.get(attribution.featureId);
    if (existing && confidenceRank[existing.confidence] >= confidenceRank[attribution.confidence]) continue;
    const total = totalsByFeatureId.get(attribution.featureId);
    featureRows.set(attribution.featureId, {
      name: attribution.featureName,
      evidence: evidenceLabels[attribution.evidence],
      confidence: attribution.confidence,
      confidenceLabel: confidenceLabels[attribution.confidence],
      suggested: attribution.suggested,
      ...(view === "internal" ? { commitId: attribution.commitId } : {}),
      activeLabel: total ? `${total.activeMinutes} 分钟` : "未分配",
      runLabel: total ? `${total.runMinutes} 分钟` : "未分配",
      evidenceCount: total ? String(total.evidenceCount) : "—"
    });
  }
  for (const total of visibleFeatureTotals) {
    if (featureRows.has(total.featureId)) continue;
    featureRows.set(total.featureId, {
      name: namesByFeatureId.get(total.featureId) ?? total.featureId,
      evidence: "已明确关联区间",
      confidence: "high",
      confidenceLabel: confidenceLabels.high,
      suggested: false,
      activeLabel: `${total.activeMinutes} 分钟`,
      runLabel: `${total.runMinutes} 分钟`,
      evidenceCount: String(total.evidenceCount)
    });
  }
  return nunjucks.renderString(reportTemplate, {
    displayName,
    statusColor: hasData ? "#0f7b3e" : "#805b00",
    statusLabel: hasData ? "数据可用" : "无数据",
    view,
    viewLabel: view === "internal" ? "内部报告" : "客户报告",
    summary: view === "customer"
      ? "客户视图仅包含已批准的汇总报告字段。"
      : hasData
        ? `${matchedEventCount} 条脱敏事件匹配此 Project Profile。`
        : "此 Project Profile 没有可用的匹配事件元数据。",
    warnings,
    accounting,
    sourceSummary: sourceCounts.length || sourceNotes.length
      ? [...sourceCounts.map((entry) => `${sourceLabels[entry.source]} ${entry.eventCount} 条`), ...sourceNotes].join(" · ")
      : "无匹配事件",
    legacyUnscopedWarningCount,
    dateRangeLabel: dateRange ? `${dateRange.from} 至 ${dateRange.to}` : undefined,
    coverage: renderedCoverage,
    coverageSummary,
    dailyRows: [...dailyRows.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((entry) => ({ ...entry, commitEstimateHours: ((entry.commitEstimateMinutes ?? 0) / 60).toFixed(2) })),
    commitEstimates: commitEstimates.map((estimate) => ({
      ...estimate,
      estimatedHours: (estimate.estimatedMinutes / 60).toFixed(1)
    })),
    commitEstimateTotalMinutes,
    commitEstimateTotalHours: commitEstimateTotalHours.toFixed(1),
    commitEstimateTotalDays: commitEstimateTotalDays.toFixed(1),
    commitEstimateTotalCost: `¥${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(commitEstimateTotalCost)}`,
    featureRows: [...featureRows.values()],
    featureTotalsUnavailableForRange: Boolean(dateRange && featureIntervalTotals.length && !featureIntervalTotals.some(
      (total) => total.dateRange?.from === dateRange.from && total.dateRange.to === dateRange.to
    ))
  });
}

async function writeOfflineReport(htmlPath: string, contents: string): Promise<void> {
  await mkdir(dirname(htmlPath), { recursive: true });
  const temporaryPath = `${htmlPath}.${process.pid}.${temporaryOutputSequence += 1}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, htmlPath);
}

export async function generateProjectReport(input: GenerateProjectReportInput): Promise<ProjectReportResult> {
  const period = input.month ? monthPeriod(input.month) : undefined;
  if (input.jsonPath && !period) throw new Error("JSON snapshots require a full report month");
  if (period && input.dateRange && (input.dateRange.from !== period.from || input.dateRange.to !== period.to)) throw new Error("Month and date range disagree");
  if (input.jsonPath && resolve(input.jsonPath) === resolve(input.htmlPath)) throw new Error("HTML and JSON output paths must differ");
  const { profile, events, coverage, featureAttributions, featureIntervalTotals, sourceNotes, view, dateRange, databasePath, htmlPath } = inputSchema.parse({ ...input, dateRange: period ? { from: period.from, to: period.to } : input.dateRange });
  if (view === "customer" && !dateRange) {
    throw new Error("Customer reports require an Asia/Shanghai reporting date range");
  }
  const dataDirectory = resolve(input.applicationDataDirectory ?? applicationDataDirectory());
  ensureStorageOutsideProjectRoots(databasePath, dataDirectory, profile.roots);
  if (period) {
    for (const path of [htmlPath, input.jsonPath].filter((value): value is string => Boolean(value))) {
      if (resolve(path) === resolve(databasePath)) throw new Error("Report output must not overwrite the event database");
      if (profile.roots.some((root) => resolve(path) === resolve(root.path) || resolve(path).startsWith(`${resolve(root.path)}/`))) throw new Error("Report output must be outside analysed project roots");
    }
  }
  const normalized = normalizeMatchingEvents(events, profile.roots);
  const commitReportData = dateRange
    ? await readProjectCommitReportData({ roots: profile.roots, dateRange })
    : { estimates: [], dailySummaries: [], dailyEstimates: [], commits: [], available: false };

  return serializeInProcessRefresh(async () => {
    await mkdir(dirname(databasePath), { recursive: true });
    let database: Database.Database | undefined;
    let transactionStarted = false;
    try {
      database = openEventStore(databasePath);
      database.exec("BEGIN EXCLUSIVE");
      transactionStarted = true;
      initializeEventStore(database);
      const invalidTimestampWarnings = normalized.warnings.filter((warning) => warning.reason === "invalid-timestamp");
      storeEvents(database, profile.id, normalized.events, invalidTimestampWarnings, coverage);
      const storedEvents = readStoredEvents(database, profile.id);
      const accounting = calculateIntervals(storedEvents.map((event) => ({
        id: event.eventHash,
        type: event.eventType,
        occurredAt: event.occurredAt,
        sessionId: event.sessionHash ?? undefined,
        turnId: event.turnHash ?? undefined,
        toolUseId: event.toolUseHash ?? undefined,
        agentId: event.agentHash ?? undefined,
        parentSessionId: event.lineageHash ?? undefined
      })), { dateRange });
      const sequenceWarnings = accounting.warnings.map((warning) => ({ eventHash: warning.eventId, reason: warning.reason }));
      replaceSequenceWarnings(database, profile.id, sequenceWarnings);
      const persistedInvalidTimestampWarnings = readPersistedInvalidTimestampWarnings(database, profile.id);
      const legacyUnscopedWarningCount = countLegacyUnscopedWarnings(database);
      const storedCoverage = database
        .prepare("SELECT report_date AS date, status FROM coverage WHERE project_id = ? ORDER BY report_date")
        .all(profile.id) as CoverageEntry[];
      const matchedEventCount = dateRange
        ? storedEvents.filter((event) => {
          const date = Temporal.Instant.from(event.occurredAt).toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString();
          return date >= dateRange.from && date <= dateRange.to;
        }).length
        : storedEvents.length;
      const sourceCounts = [...storedEvents
        .filter((event) => !dateRange || (() => {
          const date = Temporal.Instant.from(event.occurredAt).toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString();
          return date >= dateRange.from && date <= dateRange.to;
        })())
        .reduce((counts, event) => counts.set(event.source, (counts.get(event.source) ?? 0) + 1), new Map<StoredEvent["source"], number>())]
        .map(([source, eventCount]) => ({ source, eventCount }))
        .sort((left, right) => left.source.localeCompare(right.source));
      const resolvedCoverage = storedCoverage;
      const coverageForRange = dateRange
        ? storedCoverage.filter((entry) => entry.date >= dateRange.from && entry.date <= dateRange.to)
        : storedCoverage;
      const coverageStatus = matchedEventCount > 0 || accounting.active.wallClockMinutes > 0 || accounting.run.wallClockMinutes > 0
        ? "available"
        : coverageForRange.some((entry) => entry.status === "unknown")
          ? "unknown"
          : "no-data";
      const snapshot = period ? buildReportSnapshot({ profile, month: period.month,
        generatedAt: input.generatedAt ?? new Date().toISOString(), accounting, coverage: resolvedCoverage,
        commits: commitReportData, sourceCounts, warnings: [...persistedInvalidTimestampWarnings, ...sequenceWarnings],
        secrets: privateStrings(input.events), cursorUndated: input.cursorUndated, sourceStatus: input.sourceStatus,
        observedDates: storedEvents.map((event) => Temporal.Instant.from(event.occurredAt).toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString())
      }) : undefined;
      const renderedReport = snapshot ? renderReportSnapshot(snapshot, view) : renderReport(
        profile.displayName,
        matchedEventCount,
        [...persistedInvalidTimestampWarnings, ...sequenceWarnings],
        resolvedCoverage,
        legacyUnscopedWarningCount,
        accounting,
        featureAttributions,
        featureIntervalTotals,
        commitReportData.estimates,
        commitReportData.dailySummaries,
        commitReportData.dailyEstimates,
        sourceCounts,
        sourceNotes,
        view,
        dateRange
      );
      database.exec("COMMIT");
      transactionStarted = false;
      await writeOfflineReport(htmlPath, renderedReport);
      if (snapshot && input.jsonPath) await writeOfflineReport(input.jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      const snapshotCoverage = snapshot?.days.some((day) => day.coverage === "available") ? "available"
        : snapshot?.days.some((day) => day.coverage === "unknown") ? "unknown" : "no-data";
      return { matchedEventCount, coverage: snapshot ? snapshotCoverage : coverageStatus, htmlPath };
    } catch (error: unknown) {
      if (transactionStarted) {
        database?.exec("ROLLBACK");
      }
      throw error;
    } finally {
      database?.close();
    }
  });
}
