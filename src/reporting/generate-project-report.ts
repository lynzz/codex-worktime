import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import Database from "better-sqlite3";
import nunjucks from "nunjucks";
import { z } from "zod";

const safeIdentifierSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/);

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
  turnId: z.string().min(1).optional()
});

const inputSchema = z.object({
  profile: projectProfileSchema,
  events: z.array(eventSchema),
  databasePath: z.string().min(1),
  htmlPath: z.string().min(1)
});

export type GenerateProjectReportInput = {
  profile: unknown;
  events: unknown;
  databasePath: string;
  htmlPath: string;
  applicationDataDirectory?: string;
};

export type ProjectReportResult = {
  matchedEventCount: number;
  coverage: "available" | "no-data";
  htmlPath: string;
};

type Root = z.output<typeof projectProfileSchema>["roots"][number];

type StoredEvent = {
  sequence: number;
  eventHash: string;
  rootId: string;
  occurredAt: string;
  eventType: string;
  sessionHash: string | null;
  turnHash: string | null;
};

type EventNormalization = {
  events: StoredEvent[];
  warnings: DataQualityWarning[];
};

type DataQualityWarning = {
  eventHash: string;
  reason: "invalid-timestamp" | "missing-turn-stop" | "missing-tool-post" | "unmatched-tool-post";
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
      <p class="status">{{ statusLabel }}</p>
      <p>{{ summary }}</p>
      {% if warnings.length %}
        <p>{{ warnings.length }} data-quality warning{% if warnings.length !== 1 %}s{% endif %}.</p>
        <ul>{% for warning in warnings %}<li>{{ warning.reason }} (event {{ warning.eventHash }})</li>{% endfor %}</ul>
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
        turnHash: event.turnId ? hashIdentifier(event.turnId) : null
      });
    } catch {
      addWarning(eventHash, "invalid-timestamp");
    }
  }

  const eventsBySequence = new Map<string, StoredEvent[]>();
  for (const event of normalizedEvents) {
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
    const openToolRuns: StoredEvent[] = [];

    for (const event of orderedEvents) {
      if (event.eventType === "UserPromptSubmit") {
        if (openTurn) {
          addWarning(openTurn.eventHash, "missing-turn-stop");
        }
        openTurn = event;
      } else if (event.eventType === "Stop") {
        openTurn = undefined;
      } else if (event.eventType === "PreToolUse") {
        openToolRuns.push(event);
      } else if (event.eventType === "PostToolUse") {
        if (openToolRuns.shift() === undefined) {
          addWarning(event.eventHash, "unmatched-tool-post");
        }
      }
    }

    if (openTurn) {
      addWarning(openTurn.eventHash, "missing-turn-stop");
    }
    for (const event of openToolRuns) {
      addWarning(event.eventHash, "missing-tool-post");
    }
  }

  return { events: normalizedEvents, warnings };
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

function createEventStore(databasePath: string): Database.Database {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS events (
      event_hash TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      root_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      session_hash TEXT,
      turn_hash TEXT
    )
    ;
    CREATE TABLE IF NOT EXISTS data_quality_warnings (
      event_hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      PRIMARY KEY (event_hash, reason)
    )
  `);
  return database;
}

function storeEvents(
  database: Database.Database,
  projectId: string,
  events: readonly StoredEvent[],
  warnings: readonly DataQualityWarning[]
): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO events (
      event_hash, project_id, root_id, occurred_at, event_type, session_hash, turn_hash
    ) VALUES (
      @eventHash, @projectId, @rootId, @occurredAt, @eventType, @sessionHash, @turnHash
    )
  `);

  const insertAll = database.transaction((items: readonly StoredEvent[]) => {
    for (const event of items) {
      insert.run({ ...event, projectId });
    }
  });
  insertAll(events);

  const insertWarning = database.prepare(`
    INSERT OR IGNORE INTO data_quality_warnings (event_hash, reason) VALUES (@eventHash, @reason)
  `);
  const insertWarnings = database.transaction((items: readonly DataQualityWarning[]) => {
    for (const warning of items) {
      insertWarning.run(warning);
    }
  });
  insertWarnings(warnings);
}

function renderReport(
  displayName: string,
  matchedEventCount: number,
  warnings: readonly DataQualityWarning[]
): string {
  const hasData = matchedEventCount > 0;
  return nunjucks.renderString(reportTemplate, {
    displayName,
    statusColor: hasData ? "#0f7b3e" : "#805b00",
    statusLabel: hasData ? "Data available" : "No data",
    summary: hasData
      ? `${matchedEventCount} sanitized event${matchedEventCount === 1 ? "" : "s"} matched this Project Profile.`
      : "No matching retained event metadata is available for this Project Profile.",
    warnings
  });
}

export async function generateProjectReport(input: GenerateProjectReportInput): Promise<ProjectReportResult> {
  const { profile, events, databasePath, htmlPath } = inputSchema.parse(input);
  const dataDirectory = resolve(input.applicationDataDirectory ?? applicationDataDirectory());
  ensureStorageOutsideProjectRoots(databasePath, dataDirectory, profile.roots);
  const normalized = normalizeMatchingEvents(events, profile.roots);

  await mkdir(dirname(databasePath), { recursive: true });
  const database = createEventStore(databasePath);
  try {
    storeEvents(database, profile.id, normalized.events, normalized.warnings);
  } finally {
    database.close();
  }

  const matchedEventCount = normalized.events.length;
  const coverage = matchedEventCount > 0 ? "available" : "no-data";
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, renderReport(profile.displayName, matchedEventCount, normalized.warnings), "utf8");

  return { matchedEventCount, coverage, htmlPath };
}
