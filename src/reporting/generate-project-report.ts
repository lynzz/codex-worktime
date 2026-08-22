import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import Database from "better-sqlite3";
import nunjucks from "nunjucks";
import { z } from "zod";

import { calculateIntervals, type IntervalCalculation, type ReportingDateRange } from "../accounting/calculate-intervals.js";

const safeIdentifierSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/);
let temporaryOutputSequence = 0;
let pendingInProcessRefresh = Promise.resolve();

const projectProfileSchema = z.object({
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
  source: z.enum(["fixture", "history", "hook"]).default("fixture")
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
  view: z.enum(["internal", "customer"]).default("internal"),
  dateRange: dateRangeSchema.optional(),
  databasePath: z.string().min(1),
  htmlPath: z.string().min(1)
});

export type GenerateProjectReportInput = {
  profile: unknown;
  events: unknown;
  coverage?: unknown;
  featureAttributions?: unknown;
  featureIntervalTotals?: unknown;
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
  source: "fixture" | "history" | "hook";
};

type EventNormalization = {
  events: StoredEvent[];
  warnings: DataQualityWarning[];
};

type DataQualityWarning = {
  eventHash: string;
  reason: "invalid-timestamp" | "missing-turn-stop" | "missing-tool-post" | "unmatched-tool-post" | "out-of-order-tool-event" | "negative-tool-interval" | "out-of-order-turn-event";
};

const reportTemplate = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ displayName }} — Codex Worktime</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 46rem; color: #18212f; }
      main { border: 1px solid #d8dee9; border-radius: 0.75rem; padding: 2rem; }
      .status { font-weight: 700; color: {{ statusColor }}; }
    </style>
  </head>
  <body>
    <main>
      <h1>{{ displayName }}</h1>
      <p>{{ viewLabel }}</p>
      <p class="status">{{ statusLabel }}</p>
      <p>{{ summary }}</p>
      {% if dateRangeLabel %}<p>Reporting range: {{ dateRangeLabel }} (Asia/Shanghai)</p>{% endif %}
      <h2>Verified data</h2>
      <h3>Verified intervals</h3>
      <p>Active Interval: {{ accounting.active.wallClockMinutes }} wall-clock minutes{% if view === "internal" %} ({{ accounting.active.parallelMachineMinutes }} parallel-machine minutes){% endif %}.</p>
      <p>Run Interval: {{ accounting.run.wallClockMinutes }} wall-clock minutes{% if view === "internal" %} ({{ accounting.run.parallelMachineMinutes }} parallel-machine minutes){% endif %}.</p>
      <p>No inferred human-time metric is included in this V1 report.</p>
      <h3>Daily verified Active Interval (Asia/Shanghai)</h3>
      <ul>{% for entry in accounting.active.daily %}<li>{{ entry.date }}: {{ entry.minutes }} minutes</li>{% endfor %}</ul>
      <h3>Weekly verified Active Interval (Asia/Shanghai)</h3>
      <ul>{% for entry in accounting.active.weekly %}<li>{{ entry.week }}: {{ entry.minutes }} minutes</li>{% endfor %}</ul>
      {% if view === "internal" %}
        <p>{{ accounting.active.intervals.length }} Active Interval union segment{% if accounting.active.intervals.length !== 1 %}s{% endif %}; each is traceable to its retained boundary event identities.</p>
        <ul>{% for interval in accounting.active.intervals %}<li>{{ interval.start }}–{{ interval.end }}: {{ interval.sourceEventIds | join(', ') }}</li>{% endfor %}</ul>
      {% endif %}
      {% if view === "internal" %}
        <p>Active and Run totals are wall-clock unions; overlapping segments are deduplicated rather than added.</p>
        <p>{{ accounting.run.intervals.length }} Run Interval union segment{% if accounting.run.intervals.length !== 1 %}s{% endif %}.</p>
        <ul>{% for interval in accounting.run.intervals %}<li>{{ interval.start }}–{{ interval.end }}: {{ interval.sourceEventIds | join(', ') }}</li>{% endfor %}</ul>
      {% endif %}
      <h2>No-data and coverage</h2>
      {% if coverage.length %}<ul>{% for entry in coverage %}<li>{{ entry.date }}: {{ entry.label }}</li>{% endfor %}</ul>{% else %}<p>No coverage entries were retained; this is not a zero-time claim.</p>{% endif %}
      {% if featureAttributions.length %}
        <h2>Inferred delivery evidence</h2>
        <ul>{% for attribution in featureAttributions %}<li>{{ attribution.featureName }}: {{ attribution.evidence }} ({{ attribution.confidence }} confidence){% if attribution.suggested %} — Low-confidence suggestion{% endif %}{% if view === "internal" %} [{{ attribution.commitId }}]{% endif %}</li>{% endfor %}</ul>
      {% endif %}
      {% if featureIntervalTotals.length %}
        <h2>Feature-linked verified intervals</h2>
        <ul>{% for total in featureIntervalTotals %}<li>{{ total.displayName }}: {{ total.activeMinutes }} verified Active minutes; {{ total.runMinutes }} verified Run minutes{% if view === "internal" %} ({{ total.evidenceCount }} explicit evidence link{% if total.evidenceCount !== 1 %}s{% endif %}){% endif %}.</li>{% endfor %}</ul>
      {% endif %}
      {% if featureTotalsUnavailableForRange %}<p>Feature-linked verified intervals were not supplied with evidence for this reporting range; no feature duration is claimed.</p>{% endif %}
      {% if warnings.length and view === "internal" %}
        <p>{{ warnings.length }} data-quality warning{% if warnings.length !== 1 %}s{% endif %}.</p>
        <ul>{% for warning in warnings %}<li>{{ warning.reason }} (event {{ warning.eventHash }})</li>{% endfor %}</ul>
      {% endif %}
      {% if legacyUnscopedWarningCount and view === "internal" %}
        <p>{{ legacyUnscopedWarningCount }} global legacy warning{% if legacyUnscopedWarningCount !== 1 %}s{% endif %} could not be attributed to a Project Profile.</p>
      {% endif %}
    </main>
  </body>
</html>`;

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
  view: "internal" | "customer",
  dateRange: ReportingDateRange | undefined
): string {
  const hasData = matchedEventCount > 0 || accounting.active.wallClockMinutes > 0 || accounting.run.wallClockMinutes > 0;
  const namesByFeatureId = new Map(featureAttributions.map((attribution) => [attribution.featureId, attribution.featureName]));
  return nunjucks.renderString(reportTemplate, {
    displayName,
    statusColor: hasData ? "#0f7b3e" : "#805b00",
    statusLabel: hasData ? "Data available" : "No data",
    view,
    viewLabel: view === "internal" ? "Internal report" : "Customer report",
    summary: view === "customer"
      ? "This customer view contains only approved aggregated report fields."
      : hasData
        ? `${matchedEventCount} sanitized event${matchedEventCount === 1 ? "" : "s"} matched this Project Profile.`
        : "No matching retained event metadata is available for this Project Profile.",
    warnings,
    accounting,
    legacyUnscopedWarningCount,
    dateRangeLabel: dateRange ? `${dateRange.from} through ${dateRange.to}` : undefined,
    coverage: coverage.filter((entry) => !dateRange || (entry.date >= dateRange.from && entry.date <= dateRange.to)).map((entry) => ({
      ...entry,
      label: entry.status === "no-data" ? "no data — not zero time" : entry.status === "unknown" ? "unknown — no data claim" : "available"
    })),
    featureAttributions,
    featureIntervalTotals: featureIntervalTotals
      .filter((total) => !dateRange || (total.dateRange?.from === dateRange.from && total.dateRange.to === dateRange.to))
      .filter((total) => view === "internal" || namesByFeatureId.has(total.featureId))
      .map((total) => ({ ...total, displayName: view === "customer" ? namesByFeatureId.get(total.featureId) : total.featureId })),
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
  const { profile, events, coverage, featureAttributions, featureIntervalTotals, view, dateRange, databasePath, htmlPath } = inputSchema.parse(input);
  if (view === "customer" && !dateRange) {
    throw new Error("Customer reports require an Asia/Shanghai reporting date range");
  }
  const dataDirectory = resolve(input.applicationDataDirectory ?? applicationDataDirectory());
  ensureStorageOutsideProjectRoots(databasePath, dataDirectory, profile.roots);
  const normalized = normalizeMatchingEvents(events, profile.roots);

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
      const resolvedCoverage = storedCoverage;
      const coverageForRange = dateRange
        ? storedCoverage.filter((entry) => entry.date >= dateRange.from && entry.date <= dateRange.to)
        : storedCoverage;
      const coverageStatus = matchedEventCount > 0 || accounting.active.wallClockMinutes > 0 || accounting.run.wallClockMinutes > 0
        ? "available"
        : coverageForRange.some((entry) => entry.status === "unknown")
          ? "unknown"
          : "no-data";
      const renderedReport = renderReport(
        profile.displayName,
        matchedEventCount,
        [...persistedInvalidTimestampWarnings, ...sequenceWarnings],
        resolvedCoverage,
        legacyUnscopedWarningCount,
        accounting,
        featureAttributions,
        featureIntervalTotals,
        view,
        dateRange
      );
      database.exec("COMMIT");
      transactionStarted = false;
      await writeOfflineReport(htmlPath, renderedReport);
      return { matchedEventCount, coverage: coverageStatus, htmlPath };
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
