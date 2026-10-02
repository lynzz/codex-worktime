import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { findUserByUsername, type ReportCollector } from "@codex-worktime/timesheet-server";
import { redactReportText, reportMonthSchema } from "@codex-worktime/report-core";
import { projectProfileSchema } from "../reporting/generate-project-report.js";
import { collectMonthlyReport } from "../reporting/generate-monthly-report.js";

const identifier = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const instanceRecordSchema = z.object({ pid: z.number().int().positive(), instanceId: z.uuid(), retired: z.boolean() }).strict();

// Each incarnation owns one atomically published record; live peers never share a run identity.
async function reserveInstance(dataDirectory: string, key: string) {
  const directory = join(dataDirectory, "report-runtime");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = createHash("sha256").update(`${hostname()}\0${key}`).digest("hex").slice(0, 24);
  const interruptedInstanceIds: string[] = [];
  const interruptedRecords: string[] = [];
  for (const filename of await readdir(directory)) {
    if (!filename.startsWith(`${name}.`) || !filename.endsWith(".json")) continue;
    const path = join(directory, filename);
    let previous;
    try { previous = instanceRecordSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
    catch { continue; }
    let interrupted = previous.retired;
    if (!interrupted) {
      try { process.kill(previous.pid, 0); }
      catch (error) {
        interrupted = Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
      }
    }
    if (interrupted) {
      interruptedInstanceIds.push(previous.instanceId);
      interruptedRecords.push(path);
    }
  }
  const instanceId = randomUUID();
  const path = join(directory, `${name}.${instanceId}.json`);
  async function publish(retired: boolean) {
    const staging = `${path}.tmp`;
    await writeFile(staging, JSON.stringify({ pid: process.pid, instanceId, retired }), { mode: 0o600 });
    await rename(staging, path);
  }
  await publish(false);
  let closing: Promise<void> | undefined;
  return {
    instanceId, interruptedInstanceIds,
    close: () => closing ??= publish(true),
    recoveryComplete: async () => {
      // Remove only immutable dead/retired registrations after their database recovery succeeds.
      await Promise.all(interruptedRecords.map(async (record) => {
        try { await unlink(record); }
        catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
      }));
    },
  };
}

export type LocalReportCollectorOptions = {
  dataDirectory?: string;
  username?: string;
  historyHome?: string;
  instanceKey?: string;
};

export type LocalReportCollector = ReportCollector & { close(): Promise<void> };

/** Configuration is host-owned, never accepted from an HTTP request. */
export async function createLocalReportCollector(options: LocalReportCollectorOptions = {}): Promise<LocalReportCollector | undefined> {
  const configuredDirectory = options.dataDirectory ?? process.env.CODEX_WORKTIME_DATA_DIR;
  const username = options.username ?? process.env.CODEX_WORKTIME_LOCAL_USER;
  if (!configuredDirectory || !username) return undefined;
  const dataDirectory = resolve(configuredDirectory);
  const reservation = await reserveInstance(dataDirectory, options.instanceKey ?? process.env.PORT ?? "8787")
    .catch(() => { throw new Error("LOCAL_INSTANCE_UNAVAILABLE"); });
  async function registeredProfiles(userId: string) {
    const owner = await findUserByUsername(username!);
    if (!owner || owner.id !== userId) return [];
    let files: string[];
    try { files = await readdir(join(dataDirectory, "profiles")); } catch { return []; }
    const profiles = [];
    for (const filename of files.sort()) {
      if (!filename.endsWith(".json")) continue;
      const id = identifier.safeParse(filename.slice(0, -5));
      if (!id.success) continue;
      try {
        const profile = projectProfileSchema.parse(JSON.parse(await readFile(join(dataDirectory, "profiles", filename), "utf8")));
        if (profile.id === id.data) profiles.push({ profileId: profile.id, displayName: redactReportText(profile.displayName) });
      } catch { /* Invalid local configuration is not an available registered Profile. */ }
    }
    return profiles;
  }
  return {
    instanceId: reservation.instanceId,
    interruptedInstanceIds: reservation.interruptedInstanceIds,
    recoveryComplete: reservation.recoveryComplete,
    close: reservation.close,
    profiles: registeredProfiles,
    async collect(userId, profileId, month) {
      identifier.parse(profileId);
      reportMonthSchema.parse(month);
      if (!(await registeredProfiles(userId)).some((profile) => profile.profileId === profileId)) throw new Error("PROFILE_UNAVAILABLE");
      try { return await collectMonthlyReport({ profileId, month, dataDirectory, historyHome: options.historyHome ?? process.env.CODEX_WORKTIME_HISTORY_HOME }); }
      catch { throw new Error("REPORT_COLLECTION_FAILED"); }
    },
  };
}
