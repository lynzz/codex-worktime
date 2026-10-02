import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { api, entries, findUserByUsername, getDb, projects, tasks, users } from "@codex-worktime/timesheet-server";
import { runCli } from "../src/index";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);
const password = "cli-account-initial-password";
const username = `cli_${crypto.randomUUID().slice(0, 8)}`;

async function command(args: string[]) {
  let result = "";
  await runCli(["node", "codex-worktime", "manual", ...args], {
    stdout: { write: (text: string) => { result += text; } },
  });
  return JSON.parse(result);
}

describe.skipIf(!hasTestDb)("manual account administration through runCli", () => {
  const priorPassword = process.env.MANUAL_USER_PASSWORD;
  const priorSecret = process.env.SESSION_SECRET;
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
    process.env.MANUAL_USER_PASSWORD = password;
    process.env.SESSION_SECRET = "manual-cli-isolated-session-secret";
  });
  afterAll(async () => {
    const account = await findUserByUsername(username);
    if (account) {
      const db = getDb();
      await db.batch([
        db.delete(entries).where(eq(entries.userId, account.id)),
        db.delete(tasks).where(eq(tasks.userId, account.id)),
        db.delete(projects).where(eq(projects.userId, account.id)),
        db.delete(users).where(eq(users.id, account.id)),
      ]);
    }
    if (priorPassword === undefined) delete process.env.MANUAL_USER_PASSWORD;
    else process.env.MANUAL_USER_PASSWORD = priorPassword;
    if (priorSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = priorSecret;
  });

  it("add/list reject duplicates and expose neither passwords nor hashes", async () => {
    const created = await command(["user", "add", username]);
    expect(created.username).toBe(username);
    const original = await findUserByUsername(username);
    expect(original?.id).toBe(created.id);
    await expect(command(["user", "add", username])).rejects.toThrow();
    expect((await findUserByUsername(username))?.passwordHash).toBe(original?.passwordHash);
    const listed = z.array(z.object({ username: z.string(), createdAt: z.string() }).strict()).parse(await command(["user", "list"]));
    expect(listed).toContainEqual(expect.objectContaining({ username }));
    expect(JSON.stringify(created)).not.toContain(password);
    expect(JSON.stringify(created)).not.toContain("passwordHash");
  });

  it("passwd retains the account id and login only accepts the new password", async () => {
    const original = await findUserByUsername(username);
    process.env.MANUAL_USER_PASSWORD = "cli-account-changed-password";
    expect(await command(["user", "passwd", username])).toEqual({ username, updated: true });
    expect((await findUserByUsername(username))?.id).toBe(original?.id);
    for (const [candidate, status] of [[password, 401], [process.env.MANUAL_USER_PASSWORD, 200]] as const) {
      const response = await api.request("/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: candidate }),
      });
      expect(response.status).toBe(status);
    }
    await expect(command(["user", "passwd", "unknown_account"])).rejects.toThrow();
  });

  it("repeatable claim leaves already-owned data intact and unknown owners fail", async () => {
    const account = await findUserByUsername(username);
    const db = getDb();
    const projectId = `${username}-project`;
    const entryId = `${username}-entry`;
    await db.insert(projects).values({ id: projectId, userId: account!.id, name: "Retained CLI project" });
    await db.insert(entries).values({ id: entryId, userId: account!.id, projectId, date: "2026-10-02", title: "Retained CLI entry", minutes: 91 });
    const before = await db.select().from(entries).where(eq(entries.id, entryId));
    expect(await command(["user", "claim-orphans", username])).toEqual({ projects: 0, tasks: 0, entries: 0 });
    expect(await command(["user", "claim-orphans", username])).toEqual({ projects: 0, tasks: 0, entries: 0 });
    expect(await db.select().from(entries).where(eq(entries.id, entryId))).toEqual(before);
    await expect(command(["user", "claim-orphans", "unknown_account"])).rejects.toThrow();
  });
});
