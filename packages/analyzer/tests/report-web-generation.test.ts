import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { addUser, createApi, entries, getDb, projects, reportCollectors, reportProfiles, reportRuns, reportSnapshots, startReportCollection, tasks, users, type TimesheetApi } from "@codex-worktime/timesheet-server";
import { reportSnapshotSchema } from "@codex-worktime/report-core";
import { createLocalReportCollector, type LocalReportCollector } from "../src/manual/report-collector.js";
import { runCli } from "../src/index.js";

const exec = promisify(execFile);
const configured = Boolean(process.env.NEON_TEST_DATABASE_URL);
const username = `local_${crypto.randomUUID().slice(0, 8)}`;
const password = "local-collector-controlled-password";
const runResult = z.object({ id: z.string(), status: z.enum(["queued", "running", "succeeded", "failed"]), snapshotId: z.string().nullable(), errorCode: z.string().nullable() });

describe.skipIf(!configured)("local and hosted report generation through authenticated HTTP", () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalSecret = process.env.SESSION_SECRET;
  const originalDataDirectory = process.env.CODEX_WORKTIME_DATA_DIR;
  let directory: string;
  let root: string;
  let owner: string;
  let other: string;
  let cookie: string;
  let otherCookie: string;
  let collector: LocalReportCollector;
  let api: TimesheetApi;
  const options = () => ({ dataDirectory: directory, username, historyHome: join(directory, "no-history"), instanceKey: "integration-instance" });
  async function login(name: string) {
    const response = await api.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: name, password }) });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";")[0]!;
  }
  async function request(path: string, body?: unknown, session = cookie, method = "POST") {
    return api.request(path, { method, headers: { cookie: session, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function finish(runId: string) {
    // Poll the real database-clock broker rather than advancing a fake host clock.
    return vi.waitFor(async () => {
      const result = runResult.parse(await (await request(`/api/report-runs/${runId}`, undefined, cookie, "GET")).json());
      expect(["succeeded", "failed"]).toContain(result.status);
      return result;
    }, { timeout: 45_000, interval: 100 });
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
    process.env.SESSION_SECRET = "local-collector-integration-signing-key";
    owner = (await addUser(username, password)).id;
    other = (await addUser(`${username}_b`, password)).id;
    directory = await mkdtemp(join(tmpdir(), "report-http-"));
    process.env.CODEX_WORKTIME_DATA_DIR = directory;
    root = join(directory, "workspace");
    await mkdir(root);
    await exec("git", ["init", root]);
    await exec("git", ["-C", root, "config", "user.email", "fixture@example.test"]);
    await exec("git", ["-C", root, "config", "user.name", "Fixture"]);
    for (const date of ["2026-08-01T09:00:00+08:00", "2026-08-01T09:00:30+08:00"]) {
      await exec("git", ["-C", root, "commit", "--allow-empty", "-m", "feat(report): <b>local message</b>"], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    }
    await mkdir(join(directory, "profiles"));
    const profilePath = join(directory, "profiles", "demo.json");
    await writeFile(profilePath, JSON.stringify({ id: "demo", displayName: "本机受控报告", roots: [{ id: "main", path: root }] }));
    for (const [type, occurredAt] of [["UserPromptSubmit", "2026-08-01T01:00:00Z"], ["Stop", "2026-08-01T01:00:01.234Z"]]) {
      await runCli(["node", "cli", "hook", "--profile", profilePath, "--database", join(directory, "demo.sqlite"), "--output", join(directory, "hook.html"), "--occurred-at", occurredAt!, "--quiet"], {
        stdin: JSON.stringify({ hook_event_name: type, session_id: "PRIVATE_LOCAL_SESSION", turn_id: "PRIVATE_LOCAL_TURN", cwd: root, prompt: "PRIVATE_LOCAL_PROMPT" }),
      });
    }
    collector = (await createLocalReportCollector(options()))!;
    api = createApi();
    cookie = await login(username);
    otherCookie = await login(`${username}_b`);
    for (const [session, id] of [[cookie, owner], [otherCookie, other]]) {
      await getDb().insert(projects).values({ id: `${id}-project`, userId: id!, name: "Owned manual project" });
      expect((await request("/api/report-profiles/demo", { projectId: `${id}-project`, displayName: "本机受控报告" }, session, "PUT")).status).toBe(200);
    }
  }, 60_000);
  afterAll(async () => {
    if (collector) await collector.close();
    if (owner && other) {
      const ids = [owner, other];
      const db = getDb();
      await db.batch([
        db.delete(reportCollectors).where(inArray(reportCollectors.userId, ids)),
        db.delete(reportRuns).where(inArray(reportRuns.userId, ids)),
        db.delete(reportSnapshots).where(inArray(reportSnapshots.userId, ids)),
        db.delete(reportProfiles).where(inArray(reportProfiles.userId, ids)),
        db.delete(entries).where(inArray(entries.userId, ids)),
        db.delete(tasks).where(inArray(tasks.userId, ids)),
        db.delete(projects).where(inArray(projects.userId, ids)),
        db.delete(users).where(inArray(users.id, ids)),
      ]);
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalSecret;
    if (originalDataDirectory === undefined) delete process.env.CODEX_WORKTIME_DATA_DIR;
    else process.env.CODEX_WORKTIME_DATA_DIR = originalDataDirectory;
  });

  it("generates from the hosted API through an online trusted host without local HTTP or JSON import", async () => {
    const collection = await startReportCollection(collector);
    try {
      expect(await (await request("/api/reports/capabilities", undefined, cookie, "GET")).json()).toMatchObject({
        generate: true, generationMode: "connected",
      });
      const registered = z.object({
        profiles: z.array(z.object({ profileId: z.string(), projectId: z.string(), displayName: z.string() }).strict()),
        availableProfiles: z.array(z.object({ profileId: z.string(), displayName: z.string() }).strict()),
      }).strict().parse(await (await request("/api/report-profiles", undefined, cookie, "GET")).json());
      expect(registered.availableProfiles).toEqual([{ profileId: "demo", displayName: "本机受控报告" }]);
      expect(JSON.stringify(registered)).not.toContain(root);
      const foreignProfiles = z.object({ availableProfiles: z.array(z.unknown()) })
        .parse(await (await request("/api/report-profiles", undefined, otherCookie, "GET")).json());
      expect(foreignProfiles.availableProfiles).toEqual([]);
      expect((await request("/api/reports/generate", { profileId: "demo", month: "2026-08" }, otherCookie)).status).toBe(404);
      expect((await request("/api/reports/generate", { profileId: "unknown", month: "2026-08" })).status).toBe(404);

      const generated = await request("/api/reports/generate", { profileId: "demo", month: "2026-08" });
      expect(generated.status).toBe(202);
      const runId = z.object({ runId: z.string() }).parse(await generated.json()).runId;
      const completed = await finish(runId);
      expect(completed.status).toBe("succeeded");
      const storedResponse = await request(`/api/reports/${completed.snapshotId}`, undefined, cookie, "GET");
      expect(storedResponse.status).toBe(200);
      const stored = z.object({ id: z.string(), snapshot: reportSnapshotSchema }).parse(await storedResponse.json());
      expect(stored.snapshot.totals).toMatchObject({ activeMs: 1234, commitEstimateMs: 30000, estimatedCostCents: 125 });
      expect(stored.snapshot.days[0]).toMatchObject({ commitCount: 2, commitMessages: [{ title: "feat(report): <b>local message</b>", count: 2 }] });
      expect(stored.snapshot.sources).toContainEqual(expect.objectContaining({ source: "hook", eventCount: 2 }));
      for (const secret of [root, directory, "PRIVATE_LOCAL_SESSION", "PRIVATE_LOCAL_TURN", "PRIVATE_LOCAL_PROMPT"]) {
        expect(JSON.stringify(stored)).not.toContain(secret);
      }
      expect((await request(`/api/reports/${stored.id}`, undefined, otherCookie, "GET")).status).toBe(404);
      expect((await request(`/api/report-runs/${runId}`, undefined, otherCookie, "GET")).status).toBe(404);

      await collection.close();
      expect(await (await request("/api/reports/capabilities", undefined, cookie, "GET")).json()).toMatchObject({
        generate: false, generationMode: "offline",
      });
      expect(z.object({ availableProfiles: z.array(z.unknown()) })
        .parse(await (await request("/api/report-profiles", undefined, cookie, "GET")).json()).availableProfiles).toEqual([]);
      const offline = await request("/api/reports/generate", { profileId: "demo", month: "2026-08" });
      expect(offline.status).toBe(503);
      expect(await offline.json()).toEqual({ error: "REPORT_COLLECTOR_OFFLINE" });
      expect(await finish(runId)).toMatchObject({ status: "succeeded", snapshotId: stored.id, errorCode: null });
    } finally {
      await collection.close();
      await collector.close();
      collector = (await createLocalReportCollector(options()))!;
      api = createApi({ reportCollector: collector });
    }
  }, 60_000);

  it("interrupts a closing hosted collector and rejects its late real-builder result", async () => {
    const closingCollector = (await createLocalReportCollector(options()))!;
    const release = Promise.withResolvers<void>();
    let built = false;
    api = createApi();
    const collection = await startReportCollection({
      ...closingCollector,
      async collect(userId, profileId, month) {
        const snapshot = await closingCollector.collect(userId, profileId, month);
        built = true;
        await release.promise;
        return snapshot;
      },
    });
    try {
      const generated = await request("/api/reports/generate", { profileId: "demo", month: "2026-09" });
      expect(generated.status).toBe(202);
      const runId = z.object({ runId: z.string() }).parse(await generated.json()).runId;
      await vi.waitFor(() => expect(built).toBe(true), { timeout: 30_000, interval: 100 });
      const running = runResult.parse(await (await request(`/api/report-runs/${runId}`, undefined, cookie, "GET")).json());
      expect(running.status).toBe("running");
      const closing = collection.close();
      release.resolve();
      await closing;
      await closingCollector.close();
      expect(await finish(runId)).toMatchObject({ status: "failed", errorCode: "INTERRUPTED", snapshotId: null });
      const reports = await request("/api/reports?profileId=demo&month=2026-09", undefined, cookie, "GET");
      expect(await reports.json()).toEqual({ currentId: null, versions: [] });
      expect((await request("/api/reports/generate", { profileId: "demo", month: "2026-09" })).status).toBe(503);
    } finally {
      release.resolve();
      await collection.close();
      await closingCollector.close();
      api = createApi({ reportCollector: collector });
    }
  }, 60_000);

  it("collects real Git and SQLite Hook data, persists exact evidence, and denies another local user", async () => {
    expect((await request("/api/reports/generate", { profileId: "demo", month: "2026-08" }, otherCookie)).status).toBe(404);
    expect((await request("/api/reports/generate", { profileId: "demo", month: "2026-13" })).status).toBe(400);
    const generated = await request("/api/reports/generate", { profileId: "demo", month: "2026-08" });
    expect(generated.status).toBe(202);
    const runId = z.object({ runId: z.string() }).parse(await generated.json()).runId;
    const completed = await finish(runId);
    expect(completed.status).toBe("succeeded");
    const storedResponse = await request(`/api/reports/${completed.snapshotId}`, undefined, cookie, "GET");
    const stored = z.object({ id: z.string(), savedAt: z.string(), snapshot: reportSnapshotSchema }).parse(await storedResponse.json());
    expect(stored.snapshot.totals).toMatchObject({ activeMs: 1234, commitEstimateMs: 30000, estimatedCostCents: 125 });
    expect(stored.snapshot.days[0]).toMatchObject({ commitCount: 2, commitMessages: [{ title: "feat(report): <b>local message</b>", count: 2 }] });
    expect(stored.snapshot.sources).toContainEqual(expect.objectContaining({ source: "hook", eventCount: 2 }));
    for (const secret of [root, "PRIVATE_LOCAL_SESSION", "PRIVATE_LOCAL_TURN", "PRIVATE_LOCAL_PROMPT"]) expect(JSON.stringify(stored)).not.toContain(secret);
    const html = await request(`/api/reports/${stored.id}/export?format=html`, undefined, cookie, "GET");
    expect(await html.text()).toContain("&lt;b&gt;local message&lt;/b&gt;");
    const repeated = z.object({ runId: z.string() }).parse(await (await request("/api/reports/generate", { profileId: "demo", month: "2026-08" })).json());
    expect((await finish(repeated.runId)).snapshotId).toBe(stored.id);
    const reread = z.object({ savedAt: z.string() }).parse(await (await request(`/api/reports/${stored.id}`, undefined, cookie, "GET")).json());
    expect(reread.savedAt).toBe(stored.savedAt);
    expect((await request(`/api/report-runs/${runId}`, undefined, otherCookie, "GET")).status).toBe(404);
  }, 60_000);

  it("concurrent local incarnations recover retired work without interrupting live peers", async () => {
    const [peerA, peerB] = await Promise.all([createLocalReportCollector(options()), createLocalReportCollector(options())]);
    const peerCollection = await startReportCollection(peerA!);
    try {
      const instanceId = collector.instanceId;
      await collector.close();
      collector = (await createLocalReportCollector(options()))!;
      const interrupted = crypto.randomUUID();
      const activePeer = crypto.randomUUID();
      await getDb().insert(reportRuns).values([
        { id: interrupted, userId: owner, profileId: "demo", month: "2026-08", instanceId, status: "running" },
        { id: activePeer, userId: owner, profileId: "demo", month: "2026-08", instanceId: peerA!.instanceId, status: "running" },
      ]);
      api = createApi({ reportCollector: collector });
      const result = runResult.parse(await (await request(`/api/report-runs/${interrupted}`, undefined, cookie, "GET")).json());
      expect(result).toMatchObject({ status: "failed", snapshotId: null, errorCode: "INTERRUPTED" });
      const peer = await getDb().select().from(reportRuns).where(eq(reportRuns.id, activePeer));
      expect(peer[0]?.status).toBe("running");
    } finally { await peerCollection.close(); await peerA?.close(); await peerB?.close(); }
  }, 30_000);

  it("recovers a killed local process through the public run endpoint", async () => {
    const code = `import {createLocalReportCollector} from '@codex-worktime/analyzer/report-collector';
      const collector = await createLocalReportCollector(${JSON.stringify(options())});
      process.stdout.write(collector.instanceId + '\\n', () => process.kill(process.pid, 'SIGKILL'));`;
    let deadInstanceId = "";
    try { await exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code]); }
    catch (error) {
      const killed = z.object({ stdout: z.string(), signal: z.literal("SIGKILL") }).parse(error);
      deadInstanceId = z.uuid().parse(killed.stdout.trim());
    }
    const interrupted = crypto.randomUUID();
    await getDb().insert(reportRuns).values({ id: interrupted, userId: owner, profileId: "demo", month: "2026-08", instanceId: deadInstanceId, status: "running" });
    await collector.close();
    collector = (await createLocalReportCollector(options()))!;
    api = createApi({ reportCollector: collector });
    const result = runResult.parse(await (await request(`/api/report-runs/${interrupted}`, undefined, cookie, "GET")).json());
    expect(result).toMatchObject({ status: "failed", snapshotId: null, errorCode: "INTERRUPTED" });
  }, 30_000);
});
