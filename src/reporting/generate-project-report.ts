import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import Database from "better-sqlite3";
import nunjucks from "nunjucks";
import { z } from "zod";

import { calculateIntervals, type IntervalCalculation, type ReportingDateRange } from "../accounting/calculate-intervals.js";
import { readProjectCommitReportData } from "../attribution/read-project-commit-estimates.js";
import type { DailyCommitSummary, FeatureCommitEstimate } from "../attribution/estimate-feature-commit-time.js";

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
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ displayName }} — Codex Worktime</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #162033; background: #edf2f9; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 2rem 1rem 4rem; background: radial-gradient(circle at top right, #dbeafe, transparent 32rem), #edf2f9; }
      main { margin: 0 auto; max-width: 72rem; }
      .hero { padding: 2.5rem; border-radius: 1.5rem; background: linear-gradient(135deg, #102a43, #1e4976); color: #f8fbff; box-shadow: 0 1.5rem 3rem rgba(22, 32, 51, .18); }
      .eyebrow { margin: 0 0 .5rem; color: #b9d5f3; font-size: .78rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.4rem); letter-spacing: -.04em; }
      h2 { margin: 0 0 1rem; font-size: 1.15rem; letter-spacing: -.015em; }
      h3 { margin: 1.5rem 0 .65rem; font-size: .9rem; color: #4a5b72; }
      .hero-copy { max-width: 42rem; margin: 1rem 0 0; color: #d8eafa; }
      .status { display: inline-flex; margin: 1.35rem 0 0; padding: .42rem .72rem; border-radius: 999px; background: rgba(255,255,255,.13); color: #fff; font-size: .85rem; font-weight: 750; }
      .report-range { margin: .65rem 0 0; color: #d8eafa; font-size: .9rem; }
      .estimate-overview { display: grid; grid-template-columns: 1.35fr repeat(2, 1fr); gap: 1px; margin: 1.25rem 0; overflow: hidden; border: 1px solid #c6d9ee; border-radius: 1rem; background: #c6d9ee; box-shadow: 0 .7rem 1.7rem rgba(31, 62, 93, .08); }
      .estimate-overview > div { padding: 1.2rem 1.3rem; background: #f8fbff; }
      .estimate-overview > div:first-child { background: #e7f1ff; }
      .estimate-label { display: block; color: #28557f; font-size: .76rem; font-weight: 800; letter-spacing: .07em; }
      .estimate-value { display: block; margin-top: .45rem; color: #102a43; font-size: clamp(1.35rem, 3vw, 2rem); font-weight: 850; letter-spacing: -.045em; }
      .estimate-note { display: block; margin-top: .35rem; color: #60708a; font-size: .82rem; line-height: 1.4; }
      .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 1.25rem 0; }
      .metric { min-height: 8.75rem; padding: 1.25rem; border: 1px solid #dce6f2; border-radius: 1rem; background: #fff; box-shadow: 0 .5rem 1.5rem rgba(31, 62, 93, .06); }
      .metric-label { display: block; color: #60708a; font-size: .78rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
      .metric-value { display: block; margin-top: .55rem; color: #102a43; font-size: clamp(1.45rem, 3vw, 2.1rem); font-weight: 800; letter-spacing: -.045em; }
      .metric-note { margin: .45rem 0 0; color: #60708a; font-size: .84rem; line-height: 1.45; }
      .panel { margin-top: 1.25rem; padding: 1.4rem; border: 1px solid #dce6f2; border-radius: 1rem; background: rgba(255,255,255,.96); box-shadow: 0 .5rem 1.5rem rgba(31, 62, 93, .05); }
      .panel-note { margin: -.35rem 0 1rem; color: #60708a; font-size: .9rem; line-height: 1.5; }
      table { width: 100%; border-collapse: collapse; overflow: hidden; border: 1px solid #e3ebf5; border-radius: .8rem; }
      th, td { padding: .78rem .85rem; border-bottom: 1px solid #e7eef7; text-align: left; vertical-align: top; font-size: .88rem; }
      th { color: #51637c; background: #f6f9fd; font-size: .72rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
      tr:last-child td { border-bottom: 0; }
      .number { color: #102a43; font-variant-numeric: tabular-nums; font-weight: 750; }
      .tag { display: inline-block; padding: .18rem .45rem; border-radius: 999px; background: #e8f1fb; color: #28557f; font-size: .76rem; font-weight: 700; }
      .tag-low { background: #fff3d5; color: #805b00; }
      .tag-high { background: #e4f7ea; color: #166534; }
      .muted { color: #60708a; }
      details { margin-top: 1rem; }
      summary { cursor: pointer; color: #28557f; font-weight: 750; }
      .provenance { word-break: break-all; color: #60708a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; }
      @media (max-width: 40rem) { body { padding: 1rem .75rem 2rem; } .hero, .panel { padding: 1.15rem; } .estimate-overview, .metric-grid { grid-template-columns: 1fr; } th, td { padding: .65rem; } .hide-small { display: none; } }
    </style>
  </head>
  <body>
    <main>
      <header class="hero"><p class="eyebrow">Codex Worktime · {{ viewLabel }}</p><h1>{{ displayName }}</h1><p class="hero-copy">{{ summary }}</p><p class="status">{{ statusLabel }}</p>{% if dateRangeLabel %}<p class="report-range">{{ dateRangeLabel }} (Asia/Shanghai)</p>{% endif %}</header>
      {% if view === "internal" and commitEstimateTotalMinutes %}<section class="estimate-overview" aria-label="提交节奏推测总工时与费用"><div><span class="estimate-label">推测总工时（非核验）</span><strong class="estimate-value">{{ commitEstimateTotalHours }} 小时</strong><span class="estimate-note">约 {{ commitEstimateTotalDays }} 人天（8 小时 / 人天）</span></div><div><span class="estimate-label">推测费用</span><strong class="estimate-value">{{ commitEstimateTotalCost }}</strong><span class="estimate-note">按 ¥1,200 / 人天估算</span></div><div><span class="estimate-label">估算口径</span><strong class="estimate-value">提交节奏</strong><span class="estimate-note">不是已核验 AI 或人工工时</span></div></section>{% endif %}
      <section class="metric-grid" aria-label="已核验指标">
        <article class="metric"><span class="metric-label">活跃区间</span><strong class="metric-value">{{ accounting.active.wallClockMinutes }} 分钟</strong><p class="metric-note">已核验的墙钟时间并集{% if view === "internal" %}；{{ accounting.active.parallelMachineMinutes }} 分钟并行机器时间{% endif %}。</p></article>
        <article class="metric"><span class="metric-label">运行区间</span><strong class="metric-value">{{ accounting.run.wallClockMinutes }} 分钟</strong><p class="metric-note">仅统计可观察的工具执行或等待。</p></article>
        <article class="metric"><span class="metric-label">数据覆盖</span><strong class="metric-value">{{ coverageSummary.available }} 天可用</strong><p class="metric-note">{{ coverageSummary.unknown }} 天未知 · {{ coverageSummary.noData }} 天无数据；两者都不代表零工时。</p></article>
      </section>
      <section class="panel"><h2>已核验数据 · 汇总</h2><p class="panel-note">活跃区间与运行区间是两个独立、由事件边界确定的指标；本报告不包含推算的人类工时。</p>
        <table class="summary-table"><thead><tr><th>指标</th><th>已核验值</th><th>说明</th></tr></thead><tbody>
          <tr><td>活跃区间</td><td class="number">{{ accounting.active.wallClockMinutes }} 分钟</td><td>由完整的 UserPromptSubmit → Stop 区间构成。</td></tr>
          <tr><td>运行区间</td><td class="number">{{ accounting.run.wallClockMinutes }} 分钟</td><td>由完整的 PreToolUse → PostToolUse 区间构成。</td></tr>
          <tr><td>数据覆盖</td><td class="number">{{ coverageSummary.available }} 天可用 / {{ coverageSummary.unknown }} 天未知 / {{ coverageSummary.noData }} 天无数据</td><td>未知或无数据都不代表零工时。</td></tr>
        </tbody></table></section>
      <section class="panel"><h2>{% if view === "internal" %}已核验区间、提交节奏与数据覆盖{% else %}已核验区间与数据覆盖{% endif %}</h2>
        <h3>按日活跃区间与提交历史（Asia/Shanghai）</h3><table class="detail-table"><thead><tr><th>日期</th><th>已核验活跃</th><th>提交历史汇总</th></tr></thead><tbody>{% for entry in dailyRows %}<tr><td>{{ entry.date }}</td><td class="number">{{ entry.activeLabel }}</td><td>{% if entry.commitCount %}<strong>{{ entry.commitCount }} 个提交</strong><br><span class="muted">{{ entry.commitSummary }}</span>{% else %}<span class="muted">—</span>{% endif %}</td></tr>{% else %}<tr><td colspan="3" class="muted">本周期没有已核验的活跃区间或提交记录。</td></tr>{% endfor %}</tbody></table>
        <h3>按周活跃区间（Asia/Shanghai）</h3><table class="detail-table"><thead><tr><th>周</th><th>分钟</th></tr></thead><tbody>{% for entry in accounting.active.weekly %}<tr><td>{{ entry.week }}</td><td class="number">{{ entry.minutes }}</td></tr>{% else %}<tr><td colspan="2" class="muted">本周期没有已核验的活跃区间。</td></tr>{% endfor %}</tbody></table>
        {% if view === "internal" %}<h3>提交节奏推测 · 按功能分组</h3><p class="panel-note">按 Conventional Commit 的 scope 自动分组：只有相邻且属于同一分组的提交才累计间隔，每段最多 60 分钟。它是提交节奏推测，不是已核验 AI 或人工工时。</p>{% if commitEstimates.length %}
          <table class="detail-table"><thead><tr><th>功能分组</th><th>提交数</th><th>推测投入</th></tr></thead><tbody>{% for row in commitEstimates %}<tr><td><strong>{{ row.featureName }}</strong></td><td class="number">{{ row.commitCount }}</td><td class="number">{{ row.estimatedMinutes }} 分钟（约 {{ row.estimatedHours }} 小时）</td></tr>{% endfor %}</tbody></table><p class="panel-note">合计：{{ commitEstimateTotalMinutes }} 分钟（约 {{ commitEstimateTotalHours }} 小时）。</p>{% else %}<p class="panel-note">本报告范围内没有可推测的连续同功能提交。</p>{% endif %}{% endif %}
        <h3>无数据与覆盖情况</h3>{% if coverage.length %}<table class="detail-table"><thead><tr><th>日期</th><th>状态</th></tr></thead><tbody>{% for entry in coverage %}<tr aria-label="{{ entry.date }}: {{ entry.label }}"><td>{{ entry.date }}</td><td>{{ entry.label }}</td></tr>{% endfor %}</tbody></table>{% else %}<p class="panel-note">没有保留覆盖记录；这不代表零工时。</p>{% endif %}
      </section>
      <section class="panel"><h2>推断的交付证据 · 功能归因与已核验分钟</h2><p class="panel-note">Git 只提供交付证据。功能只有在审阅证据将其关联到已核验区间时才会获得分钟数；commit 时间戳绝不产生工时。</p>
        <table class="detail-table"><thead><tr><th>功能</th><th>证据 / 可信度</th><th>已核验活跃</th><th>已核验运行</th>{% if view === "internal" %}<th>证据链接</th>{% endif %}</tr></thead><tbody>{% for row in featureRows %}<tr><td><strong>{{ row.name }}</strong>{% if row.suggested %}<br><span class="tag tag-low">低可信度建议</span>{% endif %}</td><td><span class="tag tag-{{ row.confidence }}">{{ row.evidence }}</span> <span class="muted">{{ row.confidenceLabel }}可信度</span>{% if view === "internal" and row.commitId %}<br><span class="provenance">{{ row.commitId }}</span>{% endif %}</td><td class="number">{{ row.activeLabel }}</td><td class="number">{{ row.runLabel }}</td>{% if view === "internal" %}<td>{{ row.evidenceCount }}</td>{% endif %}</tr>{% else %}<tr><td colspan="5" class="muted">未提供推断的功能归因，因此不主张低可信度归因。</td></tr>{% endfor %}</tbody></table>
        {% if featureTotalsUnavailableForRange %}<p class="panel-note">未提供该报告范围内的功能区间关联证据，因此不主张功能时长。</p>{% endif %}
      </section>
      {% if view === "internal" and (warnings.length or legacyUnscopedWarningCount) %}<section class="panel"><h2>审计明细</h2>{% if warnings.length %}<p class="panel-note">{{ warnings.length }} 条数据质量警告。</p><details><summary>查看规范化警告标识</summary><ul>{% for warning in warnings %}<li>{{ warning.reason }} <span class="provenance">{{ warning.eventHash }}</span></li>{% endfor %}</ul></details>{% endif %}{% if legacyUnscopedWarningCount %}<p class="panel-note">{{ legacyUnscopedWarningCount }} 条全局旧警告无法归入 Project Profile。</p>{% endif %}</section>{% endif %}
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
  commitEstimates: readonly FeatureCommitEstimate[],
  dailyCommitSummaries: readonly DailyCommitSummary[],
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
  const dailyRows = new Map<string, { date: string; activeLabel: string; commitCount?: number; commitSummary?: string }>();
  for (const entry of accounting.active.daily) dailyRows.set(entry.date, { date: entry.date, activeLabel: `${entry.minutes} 分钟` });
  for (const entry of dailyCommitSummaries) {
    const existing = dailyRows.get(entry.date);
    dailyRows.set(entry.date, {
      date: entry.date,
      activeLabel: existing?.activeLabel ?? "—",
      commitCount: entry.commitCount,
      commitSummary: entry.summary
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
    legacyUnscopedWarningCount,
    dateRangeLabel: dateRange ? `${dateRange.from} 至 ${dateRange.to}` : undefined,
    coverage: visibleCoverage.map((entry) => ({
      ...entry,
      label: entry.status === "no-data" ? "无数据（不代表零工时）" : entry.status === "unknown" ? "未知（不主张工时）" : "可用"
    })),
    coverageSummary,
    dailyRows: [...dailyRows.values()].sort((left, right) => left.date.localeCompare(right.date)),
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
  const { profile, events, coverage, featureAttributions, featureIntervalTotals, view, dateRange, databasePath, htmlPath } = inputSchema.parse(input);
  if (view === "customer" && !dateRange) {
    throw new Error("Customer reports require an Asia/Shanghai reporting date range");
  }
  const dataDirectory = resolve(input.applicationDataDirectory ?? applicationDataDirectory());
  ensureStorageOutsideProjectRoots(databasePath, dataDirectory, profile.roots);
  const normalized = normalizeMatchingEvents(events, profile.roots);
  const commitReportData = dateRange
    ? await readProjectCommitReportData({ roots: profile.roots, dateRange })
    : { estimates: [], dailySummaries: [] };

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
        commitReportData.estimates,
        commitReportData.dailySummaries,
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
