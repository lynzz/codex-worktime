import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import type { CoverageEntry, GenerateProjectReportInput } from "../reporting/generate-project-report.js";

const profileSchema = z.object({
  roots: z.array(z.object({ id: z.string(), path: z.string() })).min(1)
});

const inputSchema = z.object({
  profile: profileSchema,
  paths: z.array(z.string().min(1)).min(1),
  dateRange: z.object({ from: z.string(), to: z.string() }).optional()
});

type HistoricalEvent = Extract<GenerateProjectReportInput["events"], unknown>;

export type HistoricalImportResult = {
  events: HistoricalEvent[];
  coverage: CoverageEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function matchesProfile(cwd: string, roots: readonly { id: string; path: string }[]): boolean {
  const normalizedCwd = resolve(cwd);
  return roots.some((root) => {
    const normalizedRoot = resolve(root.path);
    return normalizedCwd === normalizedRoot || normalizedCwd.startsWith(`${normalizedRoot}/`);
  });
}

function eventType(recordType: string): "SessionStart" | "UserPromptSubmit" | undefined {
  if (recordType === "session_meta") {
    return "SessionStart";
  }
  if (recordType === "turn_context") {
    return "UserPromptSubmit";
  }
  return undefined;
}

function datesInRange(
  from: string,
  to: string,
  matchingDates: ReadonlySet<string>,
  observedDates: ReadonlySet<string>,
  hasUnreadableSource: boolean
): CoverageEntry[] {
  const entries: CoverageEntry[] = [];
  for (let date = Temporal.PlainDate.from(from); Temporal.PlainDate.compare(date, Temporal.PlainDate.from(to)) <= 0; date = date.add({ days: 1 })) {
    const value = date.toString();
    const status = matchingDates.has(value)
      ? "available"
      : hasUnreadableSource || !observedDates.has(value)
        ? "unknown"
        : "no-data";
    entries.push({ date: value, status });
  }
  return entries;
}

export async function importHistoricalJsonl(input: unknown): Promise<HistoricalImportResult> {
  const { profile, paths, dateRange } = inputSchema.parse(input);
  const events: Record<string, unknown>[] = [];
  const eventIds = new Set<string>();
  const matchingDates = new Set<string>();
  const observedDates = new Set<string>();
  let hasUnreadableSource = false;

  for (const path of paths) {
    try {
      const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of lines) {
      let record: unknown;
      try {
        record = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!isRecord(record) || !isRecord(record.payload)) {
        continue;
      }
      const type = eventType(stringField(record, "type") ?? "");
      const timestamp = stringField(record, "timestamp");
      const cwd = stringField(record.payload, "cwd");
      if (!timestamp) {
        continue;
      }
      let reportDate: string;
      try {
        reportDate = Temporal.Instant.from(timestamp).toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString();
        observedDates.add(reportDate);
      } catch {
        continue;
      }
      if (!type || !cwd || !matchesProfile(cwd, profile.roots)) {
        continue;
      }
      const sessionId = stringField(record.payload, "session_id");
      const turnId = stringField(record.payload, "turn_id");
      const parentSessionId = stringField(record.payload, "parent_session_id");
      const id = createHash("sha256")
        .update(JSON.stringify({ type, timestamp, cwd, sessionId, turnId, parentSessionId }))
        .digest("hex");
      if (eventIds.has(id)) {
        continue;
      }
      eventIds.add(id);
      matchingDates.add(reportDate);
      events.push({
        id,
        occurredAt: timestamp,
        type,
        cwd,
        sessionId,
        turnId,
        parentSessionId,
        source: "history"
      });
    }
    } catch {
      hasUnreadableSource = true;
    }
  }

  return {
    events,
    coverage: dateRange
      ? datesInRange(dateRange.from, dateRange.to, matchingDates, observedDates, hasUnreadableSource)
      : []
  };
}
