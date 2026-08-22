import { Temporal } from "@js-temporal/polyfill";

const reportTimeZone = "Asia/Shanghai";

type EventType = "UserPromptSubmit" | "Stop" | "PreToolUse" | "PostToolUse" | string;

export type AccountingEvent = {
  id: string;
  type: EventType;
  occurredAt: string;
  sessionId?: string;
  turnId?: string;
  toolUseId?: string;
  agentId?: string;
  parentSessionId?: string;
};

type Warning = { eventId: string; reason: "missing-turn-stop" | "missing-tool-post" | "unmatched-tool-post" | "invalid-timestamp" };
type Bucket = { date: string; minutes: number };
type WeekBucket = { week: string; minutes: number };
type Totals = { wallClockMinutes: number; parallelMachineMinutes: number; daily: Bucket[]; weekly: WeekBucket[] };
type Interval = { start: number; end: number };

export type IntervalCalculation = { active: Totals; run: Totals; warnings: Warning[] };

function minutes(start: number, end: number): number {
  return (end - start) / 60_000;
}

function union(intervals: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      result.push({ ...interval });
    }
  }
  return result;
}

function addBuckets(intervals: readonly Interval[]): { daily: Bucket[]; weekly: WeekBucket[] } {
  const daily = new Map<string, number>();
  const weekly = new Map<string, number>();
  for (const interval of intervals) {
    let cursor = interval.start;
    while (cursor < interval.end) {
      const zoned = Temporal.Instant.fromEpochMilliseconds(cursor).toZonedDateTimeISO(reportTimeZone);
      const date = zoned.toPlainDate();
      const nextMidnight = Temporal.ZonedDateTime.from({
        timeZone: reportTimeZone,
        year: date.year,
        month: date.month,
        day: date.day,
        hour: 0
      }).add({ days: 1 }).epochMilliseconds;
      const segmentEnd = Math.min(interval.end, nextMidnight);
      const duration = minutes(cursor, segmentEnd);
      const dateKey = date.toString();
      const weekKey = `${date.yearOfWeek}-W${String(date.weekOfYear).padStart(2, "0")}`;
      daily.set(dateKey, (daily.get(dateKey) ?? 0) + duration);
      weekly.set(weekKey, (weekly.get(weekKey) ?? 0) + duration);
      cursor = segmentEnd;
    }
  }
  return {
    daily: [...daily].map(([date, value]) => ({ date, minutes: value })),
    weekly: [...weekly].map(([week, value]) => ({ week, minutes: value }))
  };
}

function totals(intervals: readonly Interval[]): Totals {
  const merged = union(intervals);
  const buckets = addBuckets(merged);
  return {
    wallClockMinutes: merged.reduce((sum, interval) => sum + minutes(interval.start, interval.end), 0),
    parallelMachineMinutes: intervals.reduce((sum, interval) => sum + minutes(interval.start, interval.end), 0),
    ...buckets
  };
}

export function calculateIntervals(events: readonly AccountingEvent[]): IntervalCalculation {
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  const ordered: Array<AccountingEvent & { epochMilliseconds: number; sequence: number }> = [];
  for (const [sequence, event] of events.entries()) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    try {
      ordered.push({ ...event, epochMilliseconds: Temporal.Instant.from(event.occurredAt).epochMilliseconds, sequence });
    } catch {
      warnings.push({ eventId: event.id, reason: "invalid-timestamp" });
    }
  }
  ordered.sort((left, right) => left.epochMilliseconds - right.epochMilliseconds || left.sequence - right.sequence);

  const active: Interval[] = [];
  const run: Interval[] = [];
  const openTurns = new Map<string, (typeof ordered)[number]>();
  const openTools = new Map<string, (typeof ordered)[number]>();
  const stream = (event: (typeof ordered)[number]) =>
    event.parentSessionId ?? event.sessionId ?? event.turnId ?? event.agentId ?? event.id;

  for (const event of ordered) {
    const streamKey = stream(event);
    if (event.type === "UserPromptSubmit") {
      const previous = openTurns.get(streamKey);
      if (previous) warnings.push({ eventId: previous.id, reason: "missing-turn-stop" });
      openTurns.set(streamKey, event);
    } else if (event.type === "Stop") {
      const start = openTurns.get(streamKey);
      if (start) {
        if (event.epochMilliseconds >= start.epochMilliseconds) active.push({ start: start.epochMilliseconds, end: event.epochMilliseconds });
        openTurns.delete(streamKey);
      }
    } else if (event.type === "PreToolUse") {
      openTools.set(`${streamKey}:${event.toolUseId ?? event.id}`, event);
    } else if (event.type === "PostToolUse") {
      const key = `${streamKey}:${event.toolUseId ?? event.id}`;
      const start = openTools.get(key);
      if (!start || event.epochMilliseconds < start.epochMilliseconds) {
        warnings.push({ eventId: event.id, reason: "unmatched-tool-post" });
      } else {
        run.push({ start: start.epochMilliseconds, end: event.epochMilliseconds });
        openTools.delete(key);
      }
    }
  }
  for (const event of openTurns.values()) warnings.push({ eventId: event.id, reason: "missing-turn-stop" });
  for (const event of openTools.values()) warnings.push({ eventId: event.id, reason: "missing-tool-post" });
  return { active: totals(active), run: totals(run), warnings };
}
