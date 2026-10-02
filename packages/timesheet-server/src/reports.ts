import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  calculateReportDigest, redactReportText, renderReportSnapshot,
  reportMonthSchema, reportSnapshotSchema, type ReportSnapshot,
} from "@codex-worktime/report-core";
import type { AppEnv } from "./auth.js";
import { getDb } from "./db.js";
import { projects, reportCollectors, reportProfiles, reportSnapshots, reportRuns } from "./schema.js";

export interface ReportCollector {
  instanceId: string;
  ownerId(): Promise<string | undefined>;
  interruptedInstanceIds?: readonly string[];
  recoveryComplete?(): Promise<void>;
  profiles(userId: string): Promise<{ profileId: string; displayName: string }[]>;
  collect(userId: string, profileId: string, month: string): Promise<ReportSnapshot>;
}

export interface ReportCollection {
  close(): Promise<void>;
}

const profileIdSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/).max(128);
const displayNameSchema = z.string().min(1).max(1000).refine((text) => redactReportText(text) === text);
const localProfileSchema = z.object({ profileId: profileIdSchema, displayName: displayNameSchema }).strict();
const mappingSchema = z.object({ projectId: z.string().min(1).max(128), displayName: displayNameSchema }).strict();
const selectionSchema = z.object({ profileId: profileIdSchema, month: reportMonthSchema }).strict();
export const reportSummarySchema = z.object({
  id: z.string(), profileId: profileIdSchema, month: reportMonthSchema, displayName: displayNameSchema,
  savedAt: z.iso.datetime(), generatedAt: z.iso.datetime(), source: z.enum(["import", "generated"]),
  schemaVersion: z.number().int(), algorithmVersion: z.string(),
}).strict();
export const reportDetailSchema = reportSummarySchema.extend({ snapshot: reportSnapshotSchema }).strict();
export const reportRunSchema = z.object({
  id: z.string(), profileId: profileIdSchema, month: reportMonthSchema,
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  createdAt: z.iso.datetime(), startedAt: z.iso.datetime().nullable(), finishedAt: z.iso.datetime().nullable(),
  errorCode: z.enum(["COLLECT_FAILED", "SAVE_FAILED", "INTERRUPTED"]).nullable(), snapshotId: z.string().nullable(),
}).strict();
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export type ReportDetail = z.infer<typeof reportDetailSchema>;
export type ReportRun = z.infer<typeof reportRunSchema>;

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Reads at most the limit, including bodies without Content-Length. */
async function boundedJson(request: Request, limit = MAX_IMPORT_BYTES): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > limit) throw new HTTPException(413, { message: "REPORT_TOO_LARGE" });
  if (!request.body) throw new HTTPException(400, { message: "INVALID_REPORT_JSON" });
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HTTPException(413, { message: "REPORT_TOO_LARGE" });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(400, { message: "INVALID_REPORT_JSON" });
  } finally {
    reader.releaseLock();
  }
}

function summary(row: typeof reportSnapshots.$inferSelect): ReportSummary {
  return reportSummarySchema.parse({
    id: row.id, profileId: row.profileId, month: row.month, displayName: row.displayName,
    savedAt: row.savedAt.toISOString(), generatedAt: row.generatedAt.toISOString(),
    source: row.source, schemaVersion: row.schemaVersion, algorithmVersion: row.algorithmVersion,
  });
}
function detail(row: typeof reportSnapshots.$inferSelect): ReportDetail {
  return reportDetailSchema.parse({ ...summary(row), snapshot: row.payload });
}
function runDto(row: typeof reportRuns.$inferSelect): ReportRun {
  return reportRunSchema.parse({
    id: row.id, profileId: row.profileId, month: row.month, status: row.status,
    createdAt: row.createdAt.toISOString(), startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null, errorCode: row.errorCode, snapshotId: row.snapshotId,
  });
}
function identity(userId: string, snapshot: ReportSnapshot) {
  return and(eq(reportSnapshots.userId, userId), eq(reportSnapshots.profileId, snapshot.project.profileId),
    eq(reportSnapshots.month, snapshot.period.month), eq(reportSnapshots.schemaVersion, snapshot.schemaVersion),
    eq(reportSnapshots.algorithmVersion, snapshot.algorithmVersion), eq(reportSnapshots.inputDigest, snapshot.inputDigest));
}
async function ownedMapping(userId: string, profileId: string) {
  const [mapping] = await getDb().select().from(reportProfiles)
    .where(and(eq(reportProfiles.userId, userId), eq(reportProfiles.profileId, profileId))).limit(1);
  if (!mapping) throw new HTTPException(404, { message: "REPORT_PROFILE_NOT_FOUND" });
  return mapping;
}
async function validatedSnapshot(raw: unknown): Promise<ReportSnapshot> {
  const parsed = reportSnapshotSchema.safeParse(raw);
  if (!parsed.success) throw new HTTPException(400, { message: "INVALID_REPORT_SNAPSHOT" });
  const digest = await calculateReportDigest(parsed.data);
  if (digest !== parsed.data.inputDigest) throw new HTTPException(400, { message: "REPORT_DIGEST_MISMATCH" });
  return parsed.data;
}

/** Neon HTTP batch is one SQL transaction, including the successful run transition. */
async function persist(userId: string, snapshot: ReportSnapshot, source: "import" | "generated", run?: { id: string; instanceId: string }) {
  const db = getDb();
  const proposedId = crypto.randomUUID();
  const key = identity(userId, snapshot);
  const insert = db.insert(reportSnapshots).values({
    id: proposedId, userId, profileId: snapshot.project.profileId, month: snapshot.period.month,
    displayName: snapshot.project.displayName, generatedAt: new Date(snapshot.generatedAt), source,
    schemaVersion: snapshot.schemaVersion, algorithmVersion: snapshot.algorithmVersion, inputDigest: snapshot.inputDigest,
    activeMs: snapshot.totals.activeMs, runMs: snapshot.totals.runMs,
    commitEstimateMs: snapshot.totals.commitEstimateMs, estimatedCostCents: snapshot.totals.estimatedCostCents,
    payload: snapshot,
  }).onConflictDoNothing({ target: [
    reportSnapshots.userId, reportSnapshots.profileId, reportSnapshots.month,
    reportSnapshots.schemaVersion, reportSnapshots.algorithmVersion, reportSnapshots.inputDigest,
  ] });
  // A later statement sees a concurrent winner after ON CONFLICT waits for it.
  // Read days from the winning immutable payload, not the losing request metadata.
  const days = db.execute(sql`insert into report_days (snapshot_id, date, active_ms, run_ms, commit_count, commit_estimate_ms, payload)
    select report_snapshots.id, (d.value->>'date')::date, (d.value->>'activeMs')::bigint,
      (d.value->>'runMs')::bigint, (d.value->>'commitCount')::integer,
      (d.value->>'commitEstimateMs')::bigint, d.value
    from report_snapshots cross join lateral jsonb_array_elements(report_snapshots.payload->'days') d(value)
    where ${key}
    on conflict (snapshot_id, date) do nothing`);
  // Finalize the completion time only inside the initial successful transaction.
  // A retry's proposed id differs, so immutable winners are never refreshed.
  const complete = db.update(reportSnapshots).set({ savedAt: sql`clock_timestamp()` })
    .where(and(eq(reportSnapshots.id, proposedId), eq(reportSnapshots.userId, userId)));
  const read = db.select().from(reportSnapshots).where(key).limit(1);
  let rows: (typeof reportSnapshots.$inferSelect)[];
  if (run) {
    const ownerRun = and(eq(reportRuns.id, run.id), eq(reportRuns.userId, userId),
      eq(reportRuns.instanceId, run.instanceId), eq(reportRuns.status, "running"));
    const liveLease = sql`exists (select 1 from report_collectors
      where user_id = ${userId} and instance_id = ${run.instanceId} and lease_expires_at > clock_timestamp())`;
    const results = await db.batch([
      // Lock the lease before the run, matching retirement's lock order.
      db.select({ instanceId: reportCollectors.instanceId }).from(reportCollectors)
        .where(and(eq(reportCollectors.userId, userId), eq(reportCollectors.instanceId, run.instanceId),
          sql`${reportCollectors.leaseExpiresAt} > clock_timestamp()`)).for("share"),
      db.select({ id: reportRuns.id }).from(reportRuns).where(ownerRun).for("update"),
      db.execute(sql`select 1 / count(*)::integer as run_owned from report_runs
        where ${ownerRun} and ${liveLease}`),
      insert, days,
      db.update(reportRuns).set({ status: "succeeded", finishedAt: sql`clock_timestamp()`, errorCode: null,
        snapshotId: sql`(select ${reportSnapshots.id} from ${reportSnapshots} where ${key})` }).where(and(ownerRun, liveLease)),
      // A changed run or expired incarnation aborts every snapshot/day write.
      db.execute(sql`select 1 / count(*)::integer as run_saved from report_runs
        where id = ${run.id} and user_id = ${userId} and instance_id = ${run.instanceId}
          and status = 'succeeded' and snapshot_id = (select ${reportSnapshots.id} from ${reportSnapshots} where ${key})`),
      complete,
      read,
    ]);
    rows = results[8];
  } else {
    const results = await db.batch([insert, days, complete, read]);
    rows = results[3];
  }
  if (!rows[0]) throw new Error("REPORT_STORAGE_FAILED");
  return { report: detail(rows[0]), created: rows[0].id === proposedId };
}

const LEASE_DURATION = sql`interval '60 seconds'`;
const POLL_MS = 2000;
const HEARTBEAT_MS = 15000;

async function recoverExpiredRuns(userId: string) {
  await getDb().execute(sql`update report_runs r
    set status = 'failed', finished_at = clock_timestamp(), error_code = 'INTERRUPTED'
    where r.user_id = ${userId} and r.status in ('queued', 'running')
      and not exists (select 1 from report_collectors c
        where c.user_id = r.user_id and c.instance_id = r.instance_id
          and c.lease_expires_at > clock_timestamp()
          and c.profiles @> jsonb_build_array(jsonb_build_object('profileId', r.profile_id)))`);
}

async function registeredProfiles(userId: string, liveOnly = true) {
  const rows = await getDb().select({ profiles: reportCollectors.profiles }).from(reportCollectors)
    .where(and(eq(reportCollectors.userId, userId),
      liveOnly ? sql`${reportCollectors.leaseExpiresAt} > clock_timestamp()` : undefined))
    .orderBy(asc(reportCollectors.instanceId));
  const profiles = new Map<string, z.infer<typeof localProfileSchema>>();
  for (const row of rows) {
    for (const profile of z.array(localProfileSchema).parse(row.profiles)) {
      if (!profiles.has(profile.profileId)) profiles.set(profile.profileId, profile);
    }
  }
  return [...profiles.values()];
}

async function enqueue(userId: string, profileId: string, month: string, instanceId?: string) {
  const id = crypto.randomUUID();
  const result = await getDb().execute(sql`with host as (
    select instance_id from report_collectors
    where user_id = ${userId} and lease_expires_at > clock_timestamp()
      and profiles @> ${JSON.stringify([{ profileId }])}::jsonb
      ${instanceId === undefined ? sql`` : sql`and instance_id = ${instanceId}`}
    order by lease_expires_at desc, instance_id limit 1 for share
  ) insert into report_runs (id, user_id, profile_id, month, instance_id, status)
    select ${id}, ${userId}, ${profileId}, ${month}, instance_id, 'queued' from host
    returning id`);
  return result.rows.length ? id : undefined;
}

/** Shared by direct Node generation and the hosted broker's trusted consumer. */
class ReportExecution implements ReportCollection {
  private owner: string | undefined;
  private profiles: z.infer<typeof localProfileSchema>[] = [];
  private initialization: Promise<void> | undefined;
  private closed = false;
  private background = false;
  private pollTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private heartbeatFlight: Promise<void> | undefined;
  private flight: Promise<void> | undefined;
  private wakeRequested = false;
  private recoverUnclaimedRun = false;
  private closing: Promise<void> | undefined;

  constructor(private readonly collector: ReportCollector) {}

  initialize(): Promise<void> {
    this.initialization ??= this.register().catch((error: unknown) => {
      this.initialization = undefined;
      throw error;
    });
    return this.initialization;
  }

  private async register() {
    this.owner = await this.collector.ownerId();
    if (this.owner === undefined) return;
    if (!this.owner || !this.collector.instanceId) throw new Error("INVALID_REPORT_COLLECTOR");
    this.profiles = z.array(localProfileSchema).parse(await this.collector.profiles(this.owner));
    const instances = [this.collector.instanceId, ...(this.collector.interruptedInstanceIds ?? [])];
    const db = getDb();
    await db.batch([
      db.update(reportCollectors).set({ leaseExpiresAt: sql`clock_timestamp()` })
        .where(and(eq(reportCollectors.userId, this.owner), inArray(reportCollectors.instanceId, instances))),
      db.update(reportRuns).set({ status: "failed", finishedAt: sql`clock_timestamp()`, errorCode: "INTERRUPTED" })
        .where(and(eq(reportRuns.userId, this.owner), inArray(reportRuns.instanceId, instances),
          inArray(reportRuns.status, ["queued", "running"]))),
      db.insert(reportCollectors).values({ userId: this.owner, instanceId: this.collector.instanceId,
        profiles: this.profiles, leaseExpiresAt: sql`clock_timestamp() + ${LEASE_DURATION}` })
        .onConflictDoUpdate({ target: [reportCollectors.userId, reportCollectors.instanceId], set: {
          profiles: this.profiles, leaseExpiresAt: sql`clock_timestamp() + ${LEASE_DURATION}`,
        } }),
    ]);
    try {
      await this.collector.recoveryComplete?.();
    } catch (error) {
      // A failed startup must not leave an advertised, unconsumed registration.
      await db.batch([
        db.update(reportCollectors).set({ leaseExpiresAt: sql`clock_timestamp()` })
          .where(and(eq(reportCollectors.userId, this.owner), eq(reportCollectors.instanceId, this.collector.instanceId))),
        db.update(reportRuns).set({ status: "failed", finishedAt: sql`clock_timestamp()`, errorCode: "INTERRUPTED" })
          .where(and(eq(reportRuns.userId, this.owner), eq(reportRuns.instanceId, this.collector.instanceId),
            inArray(reportRuns.status, ["queued", "running"]))),
      ]);
      throw error;
    }
  }

  async availableProfiles(userId: string) {
    await this.initialize();
    if (this.closed || this.owner !== userId) return [];
    if (!await this.renew()) return [];
    return this.closed ? [] : this.profiles;
  }

  knownProfiles(userId: string) {
    return this.owner === userId ? this.profiles : [];
  }

  private async renew() {
    if (this.closed || !this.owner) return false;
    const updated = await getDb().update(reportCollectors)
      .set({ leaseExpiresAt: sql`clock_timestamp() + ${LEASE_DURATION}` })
      .where(and(eq(reportCollectors.userId, this.owner), eq(reportCollectors.instanceId, this.collector.instanceId),
        sql`${reportCollectors.leaseExpiresAt} > clock_timestamp()`)).returning({ instanceId: reportCollectors.instanceId });
    if (updated.length) return true;
    // An expired incarnation cannot resurrect and accept a late result.
    this.closed = true;
    this.stopTimers();
    await recoverExpiredRuns(this.owner);
    return false;
  }

  private startHeartbeat() {
    if (this.heartbeatTimer || this.heartbeatFlight || this.closed || !this.owner) return;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      this.heartbeatFlight = this.renew().then(() => {}, () => {
        // Keep retrying on the next tick; the database lease remains the fence.
      }).finally(() => {
        this.heartbeatFlight = undefined;
        if (this.background || this.flight) this.startHeartbeat();
      });
    }, HEARTBEAT_MS);
  }

  private stopTimers() {
    clearTimeout(this.pollTimer);
    clearTimeout(this.heartbeatTimer);
    this.pollTimer = undefined;
    this.heartbeatTimer = undefined;
  }

  async start() {
    await this.initialize();
    if (this.closed) throw new Error("REPORT_COLLECTOR_CLOSED");
    if (!this.owner || this.background) return;
    if (!await this.renew()) throw new Error("REPORT_COLLECTOR_OFFLINE");
    if (this.closed) throw new Error("REPORT_COLLECTOR_CLOSED");
    this.background = true;
    this.startHeartbeat();
    this.wake();
  }

  wake() {
    if (this.closed || !this.owner) return;
    if (this.flight) { this.wakeRequested = true; return; }
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.startHeartbeat();
    this.flight = this.drain().catch(() => {
      this.recoverUnclaimedRun = true;
      // Polling failures expose no source paths, histories or credentials.
    }).finally(() => {
      this.flight = undefined;
      if (this.closed) return;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        this.wake();
      } else if (this.background || this.recoverUnclaimedRun) {
        this.pollTimer = setTimeout(() => { this.pollTimer = undefined; this.wake(); }, POLL_MS);
      } else {
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }
    });
  }

  private async drain() {
    await recoverExpiredRuns(this.owner!);
    if (this.recoverUnclaimedRun) {
      // A claim may have committed despite a lost response. No local collection
      // is active between serial drains, so that abandoned claim can be retired.
      await getDb().update(reportRuns).set({ status: "failed", finishedAt: sql`clock_timestamp()`, errorCode: "INTERRUPTED" })
        .where(and(eq(reportRuns.userId, this.owner!), eq(reportRuns.instanceId, this.collector.instanceId),
          eq(reportRuns.status, "running")));
      this.recoverUnclaimedRun = false;
    }
    while (!this.closed) {
      const claimed = await getDb().execute(sql`with host as (
        select instance_id, profiles from report_collectors
        where user_id = ${this.owner!} and instance_id = ${this.collector.instanceId}
          and lease_expires_at > clock_timestamp() for share
      ), next_run as (
        select r.id from report_runs r cross join host
        where r.user_id = ${this.owner!} and r.instance_id = host.instance_id and r.status = 'queued'
          and host.profiles @> jsonb_build_array(jsonb_build_object('profileId', r.profile_id))
        order by r.created_at, r.id limit 1 for update of r skip locked
      ) update report_runs r set status = 'running', started_at = clock_timestamp()
        from next_run where r.id = next_run.id and r.status = 'queued'
        returning r.id, r.profile_id, r.month`);
      if (this.closed || !claimed.rows[0]) return;
      const run = z.object({ id: z.string(), profile_id: profileIdSchema, month: reportMonthSchema }).parse(claimed.rows[0]);
      await this.execute(run.id, run.profile_id, run.month);
    }
  }

  private async execute(id: string, profileId: string, month: string) {
    let phase: "COLLECT_FAILED" | "SAVE_FAILED" = "COLLECT_FAILED";
    try {
      const snapshot = await validatedSnapshot(await this.collector.collect(this.owner!, profileId, month));
      if (snapshot.project.profileId !== profileId || snapshot.period.month !== month) throw new Error("INVALID_COLLECTED_REPORT");
      if (this.closed) return;
      phase = "SAVE_FAILED";
      await persist(this.owner!, snapshot, "generated", { id, instanceId: this.collector.instanceId });
    } catch {
      if (this.closed) return;
      // A lost response must never downgrade a committed success.
      try {
        await getDb().update(reportRuns).set({ status: "failed", finishedAt: sql`clock_timestamp()`, errorCode: phase })
          .where(and(eq(reportRuns.id, id), eq(reportRuns.userId, this.owner!),
            eq(reportRuns.instanceId, this.collector.instanceId), eq(reportRuns.status, "running"),
            sql`exists (select 1 from report_collectors where user_id = ${this.owner!}
              and instance_id = ${this.collector.instanceId} and lease_expires_at > clock_timestamp())`));
        await recoverExpiredRuns(this.owner!);
      } catch { /* Retain unfinished state for lease/restart recovery without private diagnostics. */ }
    }
  }

  close(): Promise<void> {
    this.closed = true;
    this.background = false;
    this.stopTimers();
    this.closing ??= this.retire();
    return this.closing;
  }

  private async retire() {
    await this.initialization;
    await this.heartbeatFlight;
    try {
      if (this.owner) {
        const db = getDb();
        await db.batch([
          db.update(reportCollectors).set({ leaseExpiresAt: sql`clock_timestamp()` })
            .where(and(eq(reportCollectors.userId, this.owner), eq(reportCollectors.instanceId, this.collector.instanceId))),
          db.update(reportRuns).set({ status: "failed", finishedAt: sql`clock_timestamp()`, errorCode: "INTERRUPTED" })
            .where(and(eq(reportRuns.userId, this.owner), eq(reportRuns.instanceId, this.collector.instanceId),
              inArray(reportRuns.status, ["queued", "running"]))),
        ]);
      }
    } finally {
      await this.flight;
    }
  }
}

const executions = new WeakMap<ReportCollector, ReportExecution>();
function executionFor(collector: ReportCollector) {
  let execution = executions.get(collector);
  if (!execution) {
    execution = new ReportExecution(collector);
    executions.set(collector, execution);
  }
  return execution;
}

export async function startReportCollection(collector: ReportCollector): Promise<ReportCollection> {
  const execution = executionFor(collector);
  await execution.start();
  return execution;
}

export function createReportsRouter(collector?: ReportCollector): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const execution = collector ? executionFor(collector) : undefined;
  async function availableProfiles(userId: string) {
    return execution ? execution.availableProfiles(userId) : registeredProfiles(userId);
  }
  router.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    return c.json({ error: "REPORT_STORAGE_FAILED" }, 503);
  });
  router.use("*", async (c, next) => {
    await execution?.initialize();
    await recoverExpiredRuns(c.get("userId"));
    await next();
  });

  router.get("/reports/capabilities", async (c) => {
    const generate = (await availableProfiles(c.get("userId"))).length > 0;
    return c.json({ generate, generationMode: generate ? (execution ? "local" : "connected") : "offline",
      import: true, query: true, export: true });
  });
  router.get("/report-profiles", async (c) => {
    const userId = c.get("userId");
    const profiles = await getDb().select({ profileId: reportProfiles.profileId, projectId: reportProfiles.projectId, displayName: reportProfiles.displayName })
      .from(reportProfiles).where(eq(reportProfiles.userId, userId)).orderBy(asc(reportProfiles.displayName), asc(reportProfiles.profileId));
    return c.json({ profiles, availableProfiles: await availableProfiles(userId) });
  });
  router.put("/report-profiles/:profileId", async (c) => {
    const profileId = profileIdSchema.safeParse(c.req.param("profileId"));
    const body = mappingSchema.safeParse(await boundedJson(c.req.raw, 8192));
    if (!profileId.success || !body.success) return c.json({ error: "INVALID_REPORT_MAPPING" }, 400);
    const userId = c.get("userId");
    const db = getDb();
    try {
      const result = await db.batch([
        db.select({ id: projects.id }).from(projects)
          .where(and(eq(projects.userId, userId), eq(projects.id, body.data.projectId))).for("share"),
        db.execute(sql`select 1 / count(*)::integer as project_owned from projects
          where user_id = ${userId} and id = ${body.data.projectId}`),
        db.insert(reportProfiles).values({ userId, profileId: profileId.data, ...body.data })
          .onConflictDoUpdate({ target: [reportProfiles.userId, reportProfiles.profileId], set: body.data }).returning({
            profileId: reportProfiles.profileId, projectId: reportProfiles.projectId, displayName: reportProfiles.displayName,
          }),
      ]);
      return c.json(result[2][0]);
    } catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      if ((failure.code ?? failure.cause?.code) === "22012") return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
      if ((failure.code ?? failure.cause?.code) === "23505") return c.json({ error: "PROJECT_ALREADY_MAPPED" }, 409);
      throw error;
    }
  });
  router.post("/reports/import", async (c) => {
    const snapshot = await validatedSnapshot(await boundedJson(c.req.raw));
    const userId = c.get("userId");
    await ownedMapping(userId, snapshot.project.profileId);
    const result = await persist(userId, snapshot, "import");
    return c.json(result.report, result.created ? 201 : 200);
  });
  router.post("/reports/generate", async (c) => {
    const body = selectionSchema.safeParse(await boundedJson(c.req.raw, 8192));
    if (!body.success) return c.json({ error: "INVALID_REPORT_SELECTION" }, 400);
    const userId = c.get("userId");
    const { profileId, month } = body.data;
    await ownedMapping(userId, profileId);
    const available = await availableProfiles(userId);
    const known = execution ? execution.knownProfiles(userId) : await registeredProfiles(userId, false);
    if (!known.some((profile) => profile.profileId === profileId)) {
      return c.json({ error: "REPORT_PROFILE_NOT_FOUND" }, 404);
    }
    if (!available.some((profile) => profile.profileId === profileId)) {
      return c.json({ error: "REPORT_COLLECTOR_OFFLINE" }, 503);
    }
    const id = await enqueue(userId, profileId, month, collector?.instanceId);
    if (!id) return c.json({ error: "REPORT_COLLECTOR_OFFLINE" }, 503);
    // Only the trusted Node adapter wakes collection; Worker only persists the queue.
    execution?.wake();
    return c.json({ runId: id }, 202);
  });
  router.get("/report-runs/:id", async (c) => {
    const [run] = await getDb().select().from(reportRuns).where(and(eq(reportRuns.id, c.req.param("id")), eq(reportRuns.userId, c.get("userId"))));
    return run ? c.json(runDto(run)) : c.json({ error: "REPORT_RUN_NOT_FOUND" }, 404);
  });
  router.get("/reports", async (c) => {
    const selection = selectionSchema.safeParse({ profileId: c.req.query("profileId"), month: c.req.query("month") });
    if (!selection.success) return c.json({ error: "INVALID_REPORT_SELECTION" }, 400);
    await ownedMapping(c.get("userId"), selection.data.profileId);
    const rows = await getDb().select().from(reportSnapshots).where(and(eq(reportSnapshots.userId, c.get("userId")),
      eq(reportSnapshots.profileId, selection.data.profileId), eq(reportSnapshots.month, selection.data.month)))
      .orderBy(desc(reportSnapshots.savedAt), desc(reportSnapshots.id));
    return c.json({ currentId: rows[0]?.id ?? null, versions: rows.map(summary) });
  });
  router.get("/reports/:id", async (c) => {
    const [row] = await getDb().select().from(reportSnapshots).where(and(eq(reportSnapshots.id, c.req.param("id")), eq(reportSnapshots.userId, c.get("userId"))));
    return row ? c.json(detail(row)) : c.json({ error: "REPORT_NOT_FOUND" }, 404);
  });
  router.get("/reports/:id/export", async (c) => {
    const format = c.req.query("format");
    if (format !== "json" && format !== "html") return c.json({ error: "INVALID_REPORT_EXPORT_FORMAT" }, 400);
    const [row] = await getDb().select().from(reportSnapshots).where(and(eq(reportSnapshots.id, c.req.param("id")), eq(reportSnapshots.userId, c.get("userId"))));
    if (!row) return c.json({ error: "REPORT_NOT_FOUND" }, 404);
    const snapshot = reportSnapshotSchema.parse(row.payload);
    const filename = `report-${row.profileId}-${row.month}-${row.id}.${format}`;
    const body = format === "json" ? JSON.stringify(snapshot, null, 2) : renderReportSnapshot(snapshot);
    c.header("content-disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    c.header("content-type", format === "json" ? "application/json; charset=utf-8" : "text/html; charset=utf-8");
    c.header("x-content-type-options", "nosniff");
    return c.body(body);
  });
  return router;
}
