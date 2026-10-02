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
import { projects, reportProfiles, reportSnapshots, reportRuns } from "./schema.js";

export interface ReportCollector {
  instanceId: string;
  interruptedInstanceIds?: readonly string[];
  recoveryComplete?(): Promise<void>;
  profiles(userId: string): Promise<{ profileId: string; displayName: string }[]>;
  collect(userId: string, profileId: string, month: string): Promise<ReportSnapshot>;
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
async function persist(userId: string, snapshot: ReportSnapshot, source: "import" | "generated", runId?: string) {
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
  if (runId) {
    const ownerRun = and(eq(reportRuns.id, runId), eq(reportRuns.userId, userId), eq(reportRuns.status, "running"));
    const results = await db.batch([
      insert, days,
      db.update(reportRuns).set({ status: "succeeded", finishedAt: sql`clock_timestamp()`, errorCode: null,
        snapshotId: sql`(select ${reportSnapshots.id} from ${reportSnapshots} where ${key})` }).where(ownerRun),
      // A missing/changed run must abort the snapshot transaction, never fake success.
      db.execute(sql`select 1 / count(*)::integer as run_saved from report_runs
        where id = ${runId} and user_id = ${userId} and status = 'succeeded'
          and snapshot_id = (select ${reportSnapshots.id} from ${reportSnapshots} where ${key})`),
      complete,
      read,
    ]);
    rows = results[5];
  } else {
    const results = await db.batch([insert, days, complete, read]);
    rows = results[3];
  }
  if (!rows[0]) throw new Error("REPORT_STORAGE_FAILED");
  return { report: detail(rows[0]), created: rows[0].id === proposedId };
}

export function createReportsRouter(collector?: ReportCollector): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  let initialization: Promise<void> | undefined;
  function initialize() {
    if (!collector) return Promise.resolve();
    initialization ??= getDb().update(reportRuns).set({
      status: "failed", finishedAt: sql`clock_timestamp()`, errorCode: "INTERRUPTED",
    }).where(and(inArray(reportRuns.instanceId, [collector.instanceId, ...(collector.interruptedInstanceIds ?? [])]),
      inArray(reportRuns.status, ["queued", "running"])))
      .then(async () => { await collector.recoveryComplete?.(); })
      .catch((error: unknown) => { initialization = undefined; throw error; });
    return initialization;
  }
  async function localProfiles(userId: string) {
    if (!collector) return [];
    return z.array(localProfileSchema).parse(await collector.profiles(userId));
  }
  async function failRun(userId: string, id: string, errorCode: "COLLECT_FAILED" | "SAVE_FAILED") {
    await getDb().update(reportRuns).set({ status: "failed", finishedAt: sql`clock_timestamp()`, errorCode })
      .where(and(eq(reportRuns.id, id), eq(reportRuns.userId, userId), inArray(reportRuns.status, ["queued", "running"])));
  }
  async function generate(userId: string, id: string, profileId: string, month: string) {
    let phase: "COLLECT_FAILED" | "SAVE_FAILED" = "SAVE_FAILED";
    try {
      const started = await getDb().update(reportRuns).set({ status: "running", startedAt: sql`clock_timestamp()` })
        .where(and(eq(reportRuns.id, id), eq(reportRuns.userId, userId), eq(reportRuns.status, "queued"))).returning({ id: reportRuns.id });
      if (!started.length) return;
      phase = "COLLECT_FAILED";
      const snapshot = await validatedSnapshot(await collector!.collect(userId, profileId, month));
      if (snapshot.project.profileId !== profileId || snapshot.period.month !== month) throw new Error("INVALID_COLLECTED_REPORT");
      phase = "SAVE_FAILED";
      await persist(userId, snapshot, "generated", id);
    } catch {
      // A transaction may have committed despite a lost response; never downgrade success.
      // If failure storage is unavailable, retain unfinished state for same-instance recovery.
      try { await failRun(userId, id, phase); } catch { /* No false success, no private diagnostics. */ }
    }
  }
  router.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    return c.json({ error: "REPORT_STORAGE_FAILED" }, 503);
  });
  router.use("*", async (_c, next) => { await initialize(); await next(); });

  router.get("/reports/capabilities", async (c) => c.json({
    localGenerate: (await localProfiles(c.get("userId"))).length > 0, import: true, query: true, export: true,
  }));
  router.get("/report-profiles", async (c) => {
    const userId = c.get("userId");
    const profiles = await getDb().select({ profileId: reportProfiles.profileId, projectId: reportProfiles.projectId, displayName: reportProfiles.displayName })
      .from(reportProfiles).where(eq(reportProfiles.userId, userId)).orderBy(asc(reportProfiles.displayName), asc(reportProfiles.profileId));
    return c.json({ profiles, availableProfiles: await localProfiles(userId) });
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
    if (!collector) return c.json({ error: "LOCAL_GENERATION_UNSUPPORTED" }, 501);
    const userId = c.get("userId");
    const { profileId, month } = body.data;
    await ownedMapping(userId, profileId);
    if (!(await localProfiles(userId)).some((profile) => profile.profileId === profileId)) {
      return c.json({ error: "REPORT_PROFILE_NOT_FOUND" }, 404);
    }
    const id = crypto.randomUUID();
    await getDb().insert(reportRuns).values({ id, userId, profileId, month, instanceId: collector.instanceId, status: "queued" });
    // The Node host owns this finite task; Worker default never enters this branch.
    setTimeout(() => { void generate(userId, id, profileId, month); }, 0);
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
