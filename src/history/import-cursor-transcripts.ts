import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import type { CoverageEntry, GenerateProjectReportInput } from "../reporting/generate-project-report.js";

const inputSchema = z.object({
  sources: z.array(z.object({ path: z.string().min(1), cwd: z.string().min(1), sessionId: z.string().min(1) })).min(1),
  dateRange: z.object({ from: z.string(), to: z.string() }).optional()
});

type HistoricalEvent = Extract<GenerateProjectReportInput["events"], unknown>;

export type CursorTranscriptImportResult = {
  events: HistoricalEvent[];
  coverage: CoverageEntry[];
  detectedSessionCount: number;
  directPromptCount: number;
  completedTurnCount: number;
  missingTimestampCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordTimestamp(record: Record<string, unknown>): string | undefined {
  return stringField(record, "timestamp") ?? stringField(record, "createdAt") ?? stringField(record, "occurredAt");
}

function datesInRange(from: string, to: string, matchingDates: ReadonlySet<string>, observedDates: ReadonlySet<string>, hasUnreadableSource: boolean): CoverageEntry[] {
  const entries: CoverageEntry[] = [];
  for (let date = Temporal.PlainDate.from(from); Temporal.PlainDate.compare(date, Temporal.PlainDate.from(to)) <= 0; date = date.add({ days: 1 })) {
    const value = date.toString();
    entries.push({
      date: value,
      status: matchingDates.has(value) ? "available" : hasUnreadableSource || !observedDates.has(value) ? "unknown" : "no-data"
    });
  }
  return entries;
}

/**
 * Reads only Cursor transcript envelope metadata.  Current Cursor transcript
 * files do not include event timestamps, so they are surfaced as a source
 * statistic but deliberately never turned into estimated work time.
 */
export async function importCursorTranscripts(input: unknown): Promise<CursorTranscriptImportResult> {
  const { sources, dateRange } = inputSchema.parse(input);
  const events: Record<string, unknown>[] = [];
  const eventIds = new Set<string>();
  const matchingDates = new Set<string>();
  const observedDates = new Set<string>();
  let directPromptCount = 0;
  let completedTurnCount = 0;
  let missingTimestampCount = 0;
  let hasUnreadableSource = false;

  for (const source of sources) {
    try {
      const lines = createInterface({ input: createReadStream(source.path, { encoding: "utf8" }), crlfDelay: Infinity });
      let lineNumber = 0;
      for await (const line of lines) {
        lineNumber += 1;
        let record: unknown;
        try {
          record = JSON.parse(line) as unknown;
        } catch {
          continue;
        }
        if (!isRecord(record)) continue;
        const type = stringField(record, "role") === "user"
          ? "UserPromptSubmit"
          : stringField(record, "type") === "turn_ended" && stringField(record, "status") === "success"
            ? "Stop"
            : undefined;
        if (!type) continue;
        if (type === "UserPromptSubmit") directPromptCount += 1;
        else completedTurnCount += 1;
        const timestamp = recordTimestamp(record);
        if (!timestamp) {
          missingTimestampCount += 1;
          continue;
        }
        let reportDate: string;
        try {
          reportDate = Temporal.Instant.from(timestamp).toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString();
          observedDates.add(reportDate);
        } catch {
          missingTimestampCount += 1;
          continue;
        }
        const id = createHash("sha256")
          .update(JSON.stringify({ provider: "cursor", type, timestamp, cwd: source.cwd, sessionId: source.sessionId, lineNumber }))
          .digest("hex");
        if (eventIds.has(id)) continue;
        eventIds.add(id);
        matchingDates.add(reportDate);
        events.push({ id, occurredAt: timestamp, type, cwd: source.cwd, sessionId: source.sessionId, source: "cursor-history" });
      }
    } catch {
      hasUnreadableSource = true;
    }
  }

  return {
    events,
    coverage: dateRange ? datesInRange(dateRange.from, dateRange.to, matchingDates, observedDates, hasUnreadableSource) : [],
    detectedSessionCount: sources.length,
    directPromptCount,
    completedTurnCount,
    missingTimestampCount
  };
}
