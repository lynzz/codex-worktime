import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { calculateReportDigest, monthPeriod, reportSnapshotSchema, type ReportSnapshot } from "@codex-worktime/report-core";
import { createApi } from "../src/api";
import { addUser } from "../src/accounts";
import { getDb } from "../src/db";
import { projects, reportDays, reportProfiles, reportRuns, reportSnapshots, users } from "../src/schema";
import { reportDetailSchema, reportRunSchema, reportSummarySchema, type ReportCollector, type ReportRun } from "../src/reports";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);
const reportListSchema = z.object({ currentId: z.string().nullable(), versions: z.array(reportSummarySchema) }).strict();
const generatedSchema = z.object({ runId: z.string() }).strict();

async function fixture(month = "2026-10", duration = 370000, rate = 120000): Promise<ReportSnapshot> {
  const period = monthPeriod(month);
  const ym = Temporal.PlainYearMonth.from(month);
  const days = Array.from({ length: ym.daysInMonth }, (_, index) => ({
    date: ym.toPlainDate({ day: index + 1 }).toString(), coverage: "available" as const,
    activeMs: index === 0 ? 1001 : null, runMs: index === 0 ? 501 : null,
    commitCount: index === 0 ? 2 : 0,
    commitMessages: index === 0 ? [{ title: "fix(core): <b>safe & complete</b>", count: 2 }] : [],
    commitGroups: index === 0 ? [{ label: "core", commitCount: 2, estimatedMs: duration }] : [],
    commitEstimateMs: index === 0 ? duration : null,
  }));
  const weekly = new Map<string, { week: string; activeMs: number | null; runMs: number | null }>();
  for (const day of days) {
    const date = Temporal.PlainDate.from(day.date);
    const week = `${date.yearOfWeek}-W${String(date.weekOfYear).padStart(2, "0")}`;
    const row = weekly.get(week) ?? { week, activeMs: null, runMs: null };
    if (day.activeMs !== null) row.activeMs = (row.activeMs ?? 0) + day.activeMs;
    if (day.runMs !== null) row.runMs = (row.runMs ?? 0) + day.runMs;
    weekly.set(week, row);
  }
  const snapshot = reportSnapshotSchema.parse({
    schemaVersion: 2, algorithmVersion: "event-union-v1+commit-cadence-ms-v2",
    generatedAt: "2026-10-02T00:00:00.000Z", inputDigest: "0".repeat(64),
    project: { profileId: "fixture", displayName: "隔离报告" }, period,
    rate: { currency: "CNY", dayRateCents: rate, hoursPerDay: 8 },
    sources: [{ source: "hook", eventCount: 4, status: "available" }, { source: "git", eventCount: 2, status: "available" }],
    cursorUndated: { scope: "lifetime-not-monthly", sessionCount: 3, promptCount: 8, completedTurnCount: 2, missingTimestampCount: 3 },
    integrity: [], totals: { activeMs: 1001, runMs: 501, parallelActiveMs: null, parallelRunMs: null,
      commitEstimateMs: duration, estimatedCostCents: Math.round(duration * rate / (8 * 3600000)) },
    days, weekly: [...weekly.values()], featureAttributions: [], featureIntervalTotals: [], featureTotalsUnavailableForRange: true,
  });
  snapshot.inputDigest = await calculateReportDigest(snapshot);
  return snapshot;
}

describe.skipIf(!hasTestDb)("immutable private report API on isolated Neon", { timeout: 60000 }, () => {
  let ownerA: string;
  let ownerB: string;
  let cookieA: string;
  let cookieB: string;
  let projectA: string;
  let projectB: string;
  const previousSecret = process.env.SESSION_SECRET;
  const cloud = createApi();
  const instanceId = `report-test-${crypto.randomUUID()}`;
  let collect: ReportCollector["collect"] = async () => fixture();
  const collector: ReportCollector = {
    instanceId,
    profiles: async (userId) => userId === ownerA ? [{ profileId: "fixture", displayName: "Registered local profile" }] : [],
    collect: (...args) => collect(...args),
  };
  let local = createApi({ reportCollector: collector });

  function request(path: string, method = "GET", body?: unknown, cookie = cookieA, app = cloud) {
    return app.request(path, { method, headers: { cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function map(cookie = cookieA, projectId = projectA, profileId = "fixture") {
    return request(`/api/report-profiles/${profileId}`, "PUT", { projectId, displayName: "映射项目" }, cookie);
  }
  async function imported(snapshot?: ReportSnapshot, cookie = cookieA) {
    const response = await request("/api/reports/import", "POST", snapshot ?? await fixture(), cookie);
    expect([200, 201]).toContain(response.status);
    return reportDetailSchema.parse(await response.json());
  }
  async function waitRun(id: string, app = local): Promise<ReportRun> {
    // Real HTTP requests yield to the collector task; poll its state rather than guessing a delay.
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const response = await request(`/api/report-runs/${id}`, "GET", undefined, cookieA, app);
      expect(response.status).toBe(200);
      const run = reportRunSchema.parse(await response.json());
      if (run.status === "succeeded" || run.status === "failed") return run;
    }
    throw new Error("Report generation did not reach a terminal state");
  }
  async function clearReports() {
    const db = getDb();
    const owners = [ownerA, ownerB];
    await db.batch([
      db.delete(reportRuns).where(inArray(reportRuns.userId, owners)),
      db.delete(reportSnapshots).where(inArray(reportSnapshots.userId, owners)),
      db.delete(reportProfiles).where(inArray(reportProfiles.userId, owners)),
    ]);
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
    process.env.SESSION_SECRET = "report-api-isolation-session-secret";
    const suffix = crypto.randomUUID().slice(0, 8);
    const password = "report-api-test-password";
    const usernames = [`reports_a_${suffix}`, `reports_b_${suffix}`];
    ownerA = (await addUser(usernames[0]!, password)).id;
    ownerB = (await addUser(usernames[1]!, password)).id;
    projectA = crypto.randomUUID(); projectB = crypto.randomUUID();
    await getDb().insert(projects).values([{ id: projectA, userId: ownerA, name: "A" }, { id: projectB, userId: ownerB, name: "B" }]);
    for (const [index, username] of usernames.entries()) {
      const response = await request("/api/auth/login", "POST", { username, password }, "");
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
      if (index === 0) cookieA = cookie; else cookieB = cookie;
    }
  }, 60000);
  beforeEach(async () => {
    await clearReports();
    await getDb().insert(projects).values([
      { id: projectA, userId: ownerA, name: "A" }, { id: projectB, userId: ownerB, name: "B" },
    ]).onConflictDoNothing();
    collect = async () => fixture();
    local = createApi({ reportCollector: collector });
    expect((await map()).status).toBe(200);
  }, 60000);
  afterAll(async () => {
    if (ownerA && ownerB) {
      await clearReports();
      const db = getDb();
      await db.batch([db.delete(projects).where(inArray(projects.userId, [ownerA, ownerB])),
        db.delete(users).where(inArray(users.id, [ownerA, ownerB]))]);
    }
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }, 60000);

  it("persists full precise snapshots, deduplicates generation time and reimports exported JSON", async () => {
    const snapshot = await fixture();
    const first = await imported(snapshot);
    expect(first.snapshot).toEqual(snapshot);
    expect(first.snapshot.totals.estimatedCostCents).toBe(1542);
    expect(first.snapshot.totals.activeMs).toBe(1001);
    const changedTime = { ...snapshot, generatedAt: "2026-10-03T00:00:00.000Z" };
    const duplicate = await imported(changedTime);
    expect(duplicate).toEqual(first);
    const rows = await getDb().select().from(reportDays).where(eq(reportDays.snapshotId, first.id));
    expect(rows.map((row) => row.date).sort()).toEqual(snapshot.days.map((day) => day.date));
    expect(rows[0]?.payload).toEqual(snapshot.days.find((day) => day.date === rows[0]?.date));
    const freshSession = await request("/api/auth/me");
    expect(freshSession.status).toBe(200);
    expect(await (await request(`/api/reports/${first.id}`)).json()).toEqual(first);
    const exported = await request(`/api/reports/${first.id}/export?format=json`);
    expect(exported.headers.get("content-type")).toContain("application/json");
    expect(exported.headers.get("content-disposition")).toContain(`.${"json"}`);
    expect(await imported(reportSnapshotSchema.parse(await exported.json()))).toEqual(first);
  });

  it("keeps older fixed fees and stable latest ordering across concurrent imports and rate changes", async () => {
    const old = await imported();
    const next = await fixture("2026-10", 400001, 123456);
    const results = await Promise.all(Array.from({ length: 6 }, () => imported(next)));
    expect(new Set(results.map((report) => report.id))).toEqual(new Set([results[0]!.id]));
    const duplicateOld = await imported({ ...old.snapshot, generatedAt: "2026-10-09T00:00:00.000Z" });
    expect(duplicateOld).toEqual(old);
    const listing = reportListSchema.parse(await (await request("/api/reports?profileId=fixture&month=2026-10")).json());
    expect(listing.currentId).toBe(results[0]!.id);
    expect(listing.versions.map((report) => report.id)).toEqual([results[0]!.id, old.id]);
    expect(reportDetailSchema.parse(await (await request(`/api/reports/${old.id}`)).json()).snapshot.rate.dayRateCents).toBe(120000);
    expect((await getDb().select().from(reportDays).where(eq(reportDays.snapshotId, results[0]!.id))).length).toBe(31);
  });

  it("enforces mappings, account isolation, sessions and local profile authorization", async () => {
    expect((await map(cookieA, projectB)).status).toBe(404);
    expect((await map(cookieA, projectA, "other")).status).toBe(409);
    expect((await map(cookieB, projectB)).status).toBe(200);
    const saved = await imported();
    for (const path of [`/api/reports/${saved.id}`, `/api/reports/${saved.id}/export?format=json`, `/api/reports/${saved.id}/export?format=html`]) {
      expect((await request(path, "GET", undefined, cookieB)).status).toBe(404);
      expect((await request(path, "GET", undefined, "")).status).toBe(401);
    }
    expect((await request("/api/reports/import", "POST", { ...await fixture(), userId: ownerB })).status).toBe(400);
    expect((await request("/api/reports/generate", "POST", { profileId: "fixture", month: "2026-10" }, cookieB, local)).status).toBe(404);
    expect((await request("/api/reports/generate", "POST", { profileId: "fixture", month: "2026-10" }, "", local)).status).toBe(401);
    expect(await (await request("/api/reports/capabilities", "GET", undefined, cookieB, local)).json()).toEqual({ localGenerate: false, import: true, query: true, export: true });
    const b = await imported(await fixture(), cookieB);
    expect(b.id).not.toBe(saved.id);
    const foreignRun = await getDb().insert(reportRuns).values({ id: crypto.randomUUID(), userId: ownerB, profileId: "fixture", month: "2026-10", instanceId: "foreign", status: "queued" }).returning();
    expect((await request(`/api/report-runs/${foreignRun[0]!.id}`, "GET", undefined, cookieA, local)).status).toBe(404);
  });

  it("rejects invalid, incomplete, duplicate-date, sensitive and oversized input without partial rows", async () => {
    const snapshot = await fixture();
    const invalid = [
      { ...snapshot, schemaVersion: 999 }, { ...snapshot, inputDigest: "0".repeat(64) },
      { ...snapshot, period: { ...snapshot.period, month: "2026-13" } },
      { ...snapshot, days: [{ ...snapshot.days[0], date: "2026-10-99" }, ...snapshot.days.slice(1)] },
      { ...snapshot, totals: { ...snapshot.totals, commitEstimateMs: 1.5 } },
      { ...snapshot, days: snapshot.days.slice(1) },
      { ...snapshot, days: [snapshot.days[0], snapshot.days[0], ...snapshot.days.slice(2)] },
      { ...snapshot, project: { ...snapshot.project, roots: ["private"] } },
      { ...snapshot, days: [{ ...snapshot.days[0], commitMessages: [{ title: "/Users/private/history", count: 2 }] }, ...snapshot.days.slice(1)] },
      ...["password", "token", "secret", "api-key"].map((key) => ({
        ...snapshot, days: [{ ...snapshot.days[0], commitMessages: [{ title: `fix config {"${key}":"CREDENTIAL_SENTINEL"}`, count: 2 }] }, ...snapshot.days.slice(1)],
      })),
    ];
    for (const body of invalid) expect((await request("/api/reports/import", "POST", body)).status).toBe(400);
    expect((await cloud.request("/api/reports/import", { method: "POST", headers: { cookie: cookieA }, body: "{" })).status).toBe(400);
    expect((await cloud.request("/api/reports/import", { method: "POST", headers: { cookie: cookieA }, body: " ".repeat(2 * 1024 * 1024 + 1) })).status).toBe(413);
    expect(await getDb().select().from(reportSnapshots).where(eq(reportSnapshots.userId, ownerA))).toEqual([]);
  });

  it.each(["2025-02", "2024-02", "2026-04", "2026-10"])("preserves every calendar date in %s", async (month) => {
    const snapshot = await fixture(month);
    const saved = await imported(snapshot);
    expect(saved.snapshot.period).toEqual(monthPeriod(month));
    const days = await getDb().select().from(reportDays).where(eq(reportDays.snapshotId, saved.id));
    expect(days.map((day) => day.date).sort()).toEqual(snapshot.days.map((day) => day.date));
  });

  it("preserves unavailable verified evidence as null, separate from commit pricing", async () => {
    const snapshot = await fixture();
    snapshot.days = snapshot.days.map((day) => ({ ...day, activeMs: null, runMs: null, coverage: "unknown" }));
    snapshot.weekly = snapshot.weekly.map((week) => ({ ...week, activeMs: null, runMs: null }));
    snapshot.totals.activeMs = null; snapshot.totals.runMs = null;
    snapshot.sources[0] = { source: "hook", eventCount: 0, status: "unknown" };
    snapshot.inputDigest = await calculateReportDigest(snapshot);
    const saved = await imported(snapshot);
    expect(saved.snapshot.totals.activeMs).toBeNull();
    expect(saved.snapshot.totals.runMs).toBeNull();
    expect(saved.snapshot.days[0]?.coverage).toBe("unknown");
    expect(saved.snapshot.totals.estimatedCostCents).toBe(1542);
  });

  it("keeps report retention independent from manual reset", async () => {
    const saved = await imported();
    expect((await request("/api/projects/reset", "POST", { confirm: "CLEAR_MANUAL_DATA" })).status).toBe(200);
    expect(await (await request(`/api/reports/${saved.id}`)).json()).toEqual(saved);
    const list = reportListSchema.parse(await (await request("/api/reports?profileId=fixture&month=2026-10")).json());
    expect(list.currentId).toBe(saved.id);
    expect((await request(`/api/reports/${saved.id}/export?format=json`)).status).toBe(200);
    expect((await map()).status).toBe(404);
  });

  it("exports escaped offline HTML from saved data without local collection", async () => {
    const saved = await imported();
    const response = await request(`/api/reports/${saved.id}/export?format=html`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-disposition")).toContain(".html");
    const html = await response.text();
    expect(html).toContain("&lt;b&gt;safe &amp; complete&lt;/b&gt;");
    expect(html).toContain("非核验");
    expect(html).toContain("15.42");
    expect(html).not.toContain("<b>safe & complete</b>");
    expect((await request(`/api/reports/${saved.id}/export?format=pdf`)).status).toBe(400);
    expect((await request("/api/reports/missing/export?format=html")).status).toBe(404);
    expect((await request("/api/reports/generate", "POST", { profileId: "fixture", month: "2026-10" })).status).toBe(501);
  });

  it("converges concurrent collection/import and returns only safe owner-scoped runs", async () => {
    const snapshot = await fixture();
    collect = async () => snapshot;
    const generated = await Promise.all(Array.from({ length: 3 }, () => request("/api/reports/generate", "POST", { profileId: "fixture", month: "2026-10" }, cookieA, local)));
    const saved = await imported(snapshot);
    for (const response of generated) {
      expect(response.status).toBe(202);
      const { runId } = generatedSchema.parse(await response.json());
      const run = await waitRun(runId);
      expect(run).toEqual(expect.objectContaining({ status: "succeeded", snapshotId: saved.id, errorCode: null }));
      expect(Object.keys(run).sort()).toEqual(["createdAt", "errorCode", "finishedAt", "id", "month", "profileId", "snapshotId", "startedAt", "status"].sort());
      expect((await request(`/api/report-runs/${runId}`, "GET", undefined, cookieB, local)).status).toBe(404);
    }
    expect((await getDb().select().from(reportSnapshots).where(eq(reportSnapshots.userId, ownerA))).map((row) => row.id)).toEqual([saved.id]);
  });

  it("keeps previous reports and failed history when collection fails, then supports retry", async () => {
    const old = await imported();
    collect = async () => { throw new Error("private /Users/secret/history sk-private-token"); };
    const response = await request("/api/reports/generate", "POST", { profileId: "fixture", month: "2026-10" }, cookieA, local);
    const run = await waitRun(generatedSchema.parse(await response.json()).runId);
    expect(run.status).toBe("failed"); expect(run.errorCode).toBe("COLLECT_FAILED");
    expect(JSON.stringify(run)).not.toContain("/Users/");
    expect(await (await request(`/api/reports/${old.id}`)).json()).toEqual(old);
    collect = async () => fixture("2026-10", 400000);
    const retry = await request("/api/reports/generate", "POST", { profileId: "fixture", month: "2026-10" }, cookieA, local);
    expect((await waitRun(generatedSchema.parse(await retry.json()).runId)).status).toBe("succeeded");
    expect(reportRunSchema.parse(await (await request(`/api/report-runs/${run.id}`, "GET", undefined, cookieA, local)).json()).status).toBe("failed");
  });

  it("rolls back daily persistence and successful-run writes as one transaction", async () => {
    const db = getDb();
    const dailyConstraint = `report_test_days_${crypto.randomUUID().replaceAll("-", "")}`;
    const runConstraint = `report_test_runs_${crypto.randomUUID().replaceAll("-", "")}`;
    await db.execute(sql`alter table report_days add constraint ${sql.identifier(dailyConstraint)} check (date <> '2026-10-02'::date)`);
    try {
      expect((await request("/api/reports/import", "POST", await fixture())).status).toBe(503);
      expect(await db.select().from(reportSnapshots).where(eq(reportSnapshots.userId, ownerA))).toEqual([]);
    } finally { await db.execute(sql`alter table report_days drop constraint ${sql.identifier(dailyConstraint)}`); }
    const ownerLiteral = sql.raw(`'${ownerA.replaceAll("'", "''")}'`);
    await db.execute(sql`alter table report_runs add constraint ${sql.identifier(runConstraint)} check (user_id <> ${ownerLiteral} or status <> 'succeeded')`);
    try {
      const response = await request("/api/reports/generate", "POST", { profileId: "fixture", month: "2026-10" }, cookieA, local);
      const run = await waitRun(generatedSchema.parse(await response.json()).runId);
      expect(run.status).toBe("failed"); expect(run.errorCode).toBe("SAVE_FAILED"); expect(run.snapshotId).toBeNull();
      expect(await db.select().from(reportSnapshots).where(eq(reportSnapshots.userId, ownerA))).toEqual([]);
    } finally { await db.execute(sql`alter table report_runs drop constraint ${sql.identifier(runConstraint)}`); }
    const recovered = await imported();
    expect(recovered.snapshot.totals.estimatedCostCents).toBe(1542);
  });

  it("recovers only interrupted runs from the current collector instance", async () => {
    const db = getDb();
    const ownRun = crypto.randomUUID(); const otherRun = crypto.randomUUID();
    await db.insert(reportRuns).values([
      { id: ownRun, userId: ownerA, profileId: "fixture", month: "2026-10", instanceId, status: "running" },
      { id: otherRun, userId: ownerA, profileId: "fixture", month: "2026-10", instanceId: "other-live-instance", status: "running" },
    ]);
    const restarted = createApi({ reportCollector: collector });
    const recovered = await request(`/api/report-runs/${ownRun}`, "GET", undefined, cookieA, restarted);
    expect(await recovered.json()).toEqual(expect.objectContaining({ status: "failed", errorCode: "INTERRUPTED", snapshotId: null }));
    const other = await request(`/api/report-runs/${otherRun}`, "GET", undefined, cookieA, restarted);
    expect(await other.json()).toEqual(expect.objectContaining({ status: "running", errorCode: null }));
    expect((await request("/api/reports/generate", "POST", { profileId: "fixture", month: "2026-13" }, cookieA, restarted)).status).toBe(400);
    expect((await request("/api/reports/generate", "POST", { profileId: "unknown", month: "2026-10" }, cookieA, restarted)).status).toBe(404);
  });
});
