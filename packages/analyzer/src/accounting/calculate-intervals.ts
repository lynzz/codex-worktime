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

type Warning = { eventId: string; reason: "missing-turn-stop" | "missing-tool-post" | "unmatched-tool-post" | "invalid-timestamp" | "out-of-order-tool-event" | "negative-tool-interval" | "out-of-order-turn-event" };
type Bucket = { date: string; minutes: number };
type WeekBucket = { week: string; minutes: number };
type Totals = { wallClockMinutes: number; parallelMachineMinutes: number; daily: Bucket[]; weekly: WeekBucket[]; intervals: { start: string; end: string; sourceEventIds: string[] }[] };
type Interval = { start: number; end: number; startEventId: string; endEventId: string; sourceEventIds: string[] };

export type IntervalCalculation = { active: Totals; run: Totals; warnings: Warning[] };
export type ReportingDateRange = { from: string; to: string };

function minutes(start: number, end: number): number {
  return (end - start) / 60_000;
}

function union(intervals: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end) {
      if (interval.end > previous.end) {
        previous.end = interval.end;
        previous.endEventId = interval.endEventId;
      }
      previous.sourceEventIds = [...new Set([...previous.sourceEventIds, ...interval.sourceEventIds])];
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
    intervals: merged.map((interval) => ({
      start: Temporal.Instant.fromEpochMilliseconds(interval.start).toString(),
      end: Temporal.Instant.fromEpochMilliseconds(interval.end).toString(),
      sourceEventIds: interval.sourceEventIds
    })),
    ...buckets
  };
}

function clipToReportingDateRange(intervals: readonly Interval[], dateRange: ReportingDateRange | undefined): Interval[] {
  if (!dateRange) return [...intervals];
  const from = Temporal.PlainDate.from(dateRange.from)
    .toZonedDateTime({ timeZone: reportTimeZone, plainTime: Temporal.PlainTime.from("00:00") })
    .epochMilliseconds;
  const until = Temporal.PlainDate.from(dateRange.to)
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: reportTimeZone, plainTime: Temporal.PlainTime.from("00:00") })
    .epochMilliseconds;
  if (from >= until) throw new Error("Reporting date range must end on or after its start date");
  return intervals
    .map((interval) => ({ ...interval, start: Math.max(interval.start, from), end: Math.min(interval.end, until) }))
    .filter((interval) => interval.start < interval.end);
}

export function calculateIntervals(events: readonly AccountingEvent[], options: { dateRange?: ReportingDateRange } = {}): IntervalCalculation {
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  const seenLineageLifecycleIdentities = new Set<string>();
  const ordered: Array<AccountingEvent & { epochMilliseconds: number; sequence: number }> = [];
  for (const [sequence, event] of events.entries()) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    try {
      const lineageRoot = event.parentSessionId ?? event.sessionId;
      const identityPart = event.toolUseId ?? event.turnId;
      if (
        lineageRoot && identityPart && ["UserPromptSubmit", "Stop", "PreToolUse", "PostToolUse"].includes(event.type)
      ) {
        const lineageIdentity = `${lineageRoot}:${event.type}:${identityPart}`;
        if (seenLineageLifecycleIdentities.has(lineageIdentity)) continue;
        seenLineageLifecycleIdentities.add(lineageIdentity);
      }
      ordered.push({ ...event, epochMilliseconds: Temporal.Instant.from(event.occurredAt).epochMilliseconds, sequence });
    } catch {
      warnings.push({ eventId: event.id, reason: "invalid-timestamp" });
    }
  }
  const active: Interval[] = [];
  const run: Interval[] = [];
  const openTurns = new Map<string, (typeof ordered)[number]>();
  const currentTurnByStream = new Map<string, string>();
  const openTools = new Map<string, (typeof ordered)[number]>();
  const pendingToolPosts = new Map<string, (typeof ordered)[number]>();
  const stream = (event: (typeof ordered)[number]) =>
    event.sessionId ?? event.turnId ?? event.agentId ?? event.parentSessionId ?? event.id;
  const turnKey = (event: (typeof ordered)[number]) => `${stream(event)}:${event.turnId ?? "current"}`;
  const toolKey = (event: (typeof ordered)[number]) => `${stream(event)}:${event.toolUseId ?? event.id}`;

  for (const event of ordered) {
    const streamKey = stream(event);
    if (event.type === "UserPromptSubmit") {
      const previousKey = currentTurnByStream.get(streamKey);
      const previous = previousKey ? openTurns.get(previousKey) : undefined;
      if (previous) warnings.push({ eventId: previous.id, reason: "missing-turn-stop" });
      if (previousKey) openTurns.delete(previousKey);
      const key = turnKey(event);
      openTurns.set(key, event);
      currentTurnByStream.set(streamKey, key);
    } else if (event.type === "Stop") {
      const key = event.turnId ? turnKey(event) : currentTurnByStream.get(streamKey);
      const start = key ? openTurns.get(key) : undefined;
      if (start) {
        if (event.epochMilliseconds < start.epochMilliseconds) {
          warnings.push({ eventId: event.id, reason: "out-of-order-turn-event" });
          openTurns.delete(key!);
          if (currentTurnByStream.get(streamKey) === key) currentTurnByStream.delete(streamKey);
        } else {
          active.push({ start: start.epochMilliseconds, end: event.epochMilliseconds, startEventId: start.id, endEventId: event.id, sourceEventIds: [start.id, event.id] });
          openTurns.delete(key!);
          if (currentTurnByStream.get(streamKey) === key) currentTurnByStream.delete(streamKey);
        }
      }
    } else if (event.type === "PreToolUse") {
      const key = toolKey(event);
      const earlierPost = pendingToolPosts.get(key);
      if (earlierPost) {
        warnings.push({ eventId: earlierPost.id, reason: "out-of-order-tool-event" });
        pendingToolPosts.delete(key);
      } else {
        openTools.set(key, event);
      }
    } else if (event.type === "PostToolUse") {
      const key = toolKey(event);
      const start = openTools.get(key);
      if (!start) {
        pendingToolPosts.set(key, event);
      } else if (event.epochMilliseconds < start.epochMilliseconds) {
        warnings.push({ eventId: event.id, reason: "negative-tool-interval" });
        openTools.delete(key);
      } else {
        run.push({ start: start.epochMilliseconds, end: event.epochMilliseconds, startEventId: start.id, endEventId: event.id, sourceEventIds: [start.id, event.id] });
        openTools.delete(key);
      }
    }
  }
  for (const event of openTurns.values()) warnings.push({ eventId: event.id, reason: "missing-turn-stop" });
  for (const event of openTools.values()) warnings.push({ eventId: event.id, reason: "missing-tool-post" });
  for (const event of pendingToolPosts.values()) warnings.push({ eventId: event.id, reason: "unmatched-tool-post" });
  return {
    active: totals(clipToReportingDateRange(active, options.dateRange)),
    run: totals(clipToReportingDateRange(run, options.dateRange)),
    warnings
  };
}
