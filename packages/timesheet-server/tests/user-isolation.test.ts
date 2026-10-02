import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { z } from "zod";
import { api } from "../src/api";
import { addUser } from "../src/accounts";
import { getDb } from "../src/db";
import { entries, projects, tasks, users } from "../src/schema";

const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);
const password = "isolated-account-password";

describe.skipIf(!hasTestDb)("private manual accounts through public Hono API", () => {
  let ownerA: string;
  let ownerB: string;
  let cookieA: string;
  let cookieB: string;
  const previousSecret = process.env.SESSION_SECRET;

  function request(url: string, method = "GET", body?: unknown, cookie = cookieA) {
    return api.request(url, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
    process.env.SESSION_SECRET = "owner-isolation-matrix-session-secret";
    const db = getDb();
    await db.batch([db.delete(entries), db.delete(tasks), db.delete(projects), db.delete(users)]);
    ownerA = (await addUser("owner_a", password)).id;
    ownerB = (await addUser("owner_b", password)).id;
    for (const username of ["owner_a", "owner_b"]) {
      const login = await request("/api/auth/login", "POST", { username, password }, "");
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      if (username === "owner_a") cookieA = cookie;
      else cookieB = cookie;
    }
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  });

  beforeEach(async () => {
    const db = getDb();
    await db.batch([db.delete(entries), db.delete(tasks), db.delete(projects)]);
    await db.insert(projects).values([
      { id: "a-project", userId: ownerA, name: "Shared project", archived: false },
      { id: "b-project", userId: ownerB, name: "Shared project", archived: false },
    ]);
    await db.insert(tasks).values([
      { id: "a-task", userId: ownerA, projectId: "a-project", title: "Shared task", position: 0 },
      { id: "b-task", userId: ownerB, projectId: "b-project", title: "Shared task", position: 0 },
    ]);
    await db.insert(entries).values([
      { id: "a-entry", userId: ownerA, projectId: "a-project", taskId: "a-task", date: "2026-10-02", title: "A only", minutes: 60 },
      { id: "b-entry", userId: ownerB, projectId: "b-project", taskId: "b-task", date: "2026-10-02", title: "B only", minutes: 120 },
    ]);
  });

  it("lists, totals, XLSX export and me expose only the session account", async () => {
    for (const [path, id] of [["projects", "a-project"], ["tasks", "a-task"], ["entries", "a-entry"]]) {
      const response = await request(`/api/${path}?userId=${ownerB}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([expect.objectContaining({ id })]);
    }
    const total = await request("/api/entries/total");
    const totalBody = z.object({ minutes: z.coerce.number() }).parse(await total.json());
    expect(Number(totalBody.minutes)).toBe(60);
    expect(await (await request("/api/auth/me")).json()).toEqual({ username: "owner_a" });
    const exportResponse = await request("/api/export/xlsx?month=2026-10");
    expect(exportResponse.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportResponse.arrayBuffer());
    const worksheet = workbook.getWorksheet("任务清单")!;
    const titles: string[] = [];
    worksheet.eachRow((row) => {
      if (typeof row.getCell(1).value === "number") titles.push(String(row.getCell(3).value));
    });
    expect(titles).toEqual(["A only"]);
    const bTotal = await request("/api/entries/total", "GET", undefined, cookieB);
    const bTotalBody = z.object({ minutes: z.coerce.number() }).parse(await bTotal.json());
    expect(bTotalBody.minutes).toBe(120);
  });

  it("foreign CRUD, references, reorder and replace-cell all return 404 without mutation", async () => {
    const attempts: [string, string, unknown?][] = [
      ["/api/projects/b-project", "PATCH", { name: "stolen" }],
      ["/api/projects/b-project", "DELETE"],
      ["/api/tasks/b-task", "PATCH", { title: "stolen" }],
      ["/api/tasks/b-task", "DELETE"],
      ["/api/entries/b-entry", "PATCH", { minutes: 1 }],
      ["/api/entries/b-entry", "DELETE"],
      ["/api/tasks", "POST", { projectId: "b-project", title: "stolen" }],
      ["/api/entries", "POST", { projectId: "b-project", date: "2026-10-02", title: "stolen", minutes: 1 }],
      ["/api/tasks/reorder", "POST", { ids: ["a-task", "b-task"] }],
      ["/api/entries/replace-cell", "POST", { projectId: "b-project", taskId: "b-task", date: "2026-10-02", minutes: 1 }],
      ["/api/entries/replace-cell", "POST", { projectId: "a-project", taskId: "b-task", date: "2026-10-02", minutes: 1 }],
    ];
    for (const [url, method, body] of attempts) {
      const response = await request(url, method, body);
      expect(response.status, `${method} ${url}`).toBe(404);
    }
    const foreign = await getDb().select().from(entries).where(eq(entries.id, "b-entry"));
    expect(foreign).toEqual([expect.objectContaining({ userId: ownerB, minutes: 120, taskId: "b-task" })]);
    expect(await (await request("/api/tasks", "GET", undefined, cookieB)).json()).toEqual([
      expect.objectContaining({ id: "b-task", title: "Shared task", position: 0 }),
    ]);
  });

  it("creation ignores forged owner fields, reset removes only the session account", async () => {
    const response = await request("/api/projects", "POST", { name: "A created", userId: ownerB });
    expect(response.status).toBe(201);
    const project = z.object({ id: z.string() }).parse(await response.json());
    const saved = await getDb().select().from(projects).where(eq(projects.id, project.id));
    expect(saved[0]?.userId).toBe(ownerA);
    const newTask = await request("/api/tasks", "POST", { projectId: project.id, title: "A created", userId: ownerB });
    expect(newTask.status).toBe(201);
    const newEntry = await request("/api/entries", "POST", { projectId: project.id, title: "A created", date: "2026-10-02", minutes: 15, userId: ownerB });
    expect(newEntry.status).toBe(201);
    const taskBody = z.object({ id: z.string() }).parse(await newTask.json());
    const entryBody = z.object({ id: z.string() }).parse(await newEntry.json());
    expect((await getDb().select().from(tasks).where(eq(tasks.id, taskBody.id)))[0]?.userId).toBe(ownerA);
    expect((await getDb().select().from(entries).where(eq(entries.id, entryBody.id)))[0]?.userId).toBe(ownerA);
    expect((await request("/api/projects/reset", "POST", { confirm: "CLEAR_MANUAL_DATA", userId: ownerB })).status).toBe(200);
    for (const path of ["projects", "tasks", "entries"]) {
      expect(await (await request(`/api/${path}`)).json()).toEqual([]);
      const foreignRows = await (await request(`/api/${path}`, "GET", undefined, cookieB)).json();
      expect(foreignRows).toEqual([expect.objectContaining({ id: `b-${path === "entries" ? "entry" : path === "projects" ? "project" : "task"}` })]);
    }
  });

  it("JSON imports reject foreign ids and links before saving anything", async () => {
    const invalidInputs = [
      { projects: [{ id: "b-project", name: "stolen" }] },
      { tasks: [{ id: "b-task", projectId: "a-project", title: "stolen" }] },
      { tasks: [{ id: "new-task", projectId: "b-project", title: "stolen" }] },
      { entries: [{ id: "b-entry", projectId: "a-project", date: "2026-10-02", title: "stolen", minutes: 1 }] },
      { entries: [{ id: "new-entry", projectId: "a-project", taskId: "b-task", date: "2026-10-02", title: "stolen", minutes: 1 }] },
      { entries: [{ id: "new-entry", projectId: "unknown", date: "2026-10-02", title: "stolen", minutes: 1 }] },
    ];
    for (const input of invalidInputs) {
      const response = await request("/api/import", "POST", input);
      expect(response.status, JSON.stringify(input)).toBe(404);
    }
    const imported = await request("/api/import", "POST", {
      userId: ownerB,
      projects: [{ id: "new-project", name: "New owned import", userId: ownerB }],
      entries: [{ id: "new-entry", projectId: "new-project", date: "2026-10-02", title: "New owned import", minutes: 15, userId: ownerB }],
    });
    expect(imported.status).toBe(201);
    expect((await getDb().select().from(entries).where(eq(entries.id, "new-entry")))[0]?.userId).toBe(ownerA);
  });

  it("concurrent imports sharing global ids never create cross-owner references", async () => {
    const payload = {
      projects: [{ id: "racing-project", name: "Racing import" }],
      tasks: [{ id: "racing-task", projectId: "racing-project", title: "Racing task" }],
      entries: [{ id: "racing-entry", projectId: "racing-project", taskId: "racing-task", date: "2026-10-02", title: "Racing task", minutes: 37 }],
    };
    const responses = await Promise.all([
      request("/api/import", "POST", payload, cookieA),
      request("/api/import", "POST", payload, cookieB),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 404]);
    const winner = responses[0]!.status === 201 ? ownerA : ownerB;
    const db = getDb();
    expect((await db.select().from(projects).where(eq(projects.id, "racing-project")))[0]?.userId).toBe(winner);
    expect((await db.select().from(tasks).where(eq(tasks.id, "racing-task")))[0]?.userId).toBe(winner);
    const imported = await db.select().from(entries).where(eq(entries.id, "racing-entry"));
    expect(imported).toEqual([expect.objectContaining({
      userId: winner, projectId: "racing-project", taskId: "racing-task", minutes: 37,
    })]);
  });

  it("XLSX import resolves matching names only inside the session account", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("任务清单");
    sheet.addRow(["项目", "任务", "日期", "评估工时(人时)"]);
    sheet.addRow(["Shared project", "Shared task", "2026-10-03", 1.5]);
    const buffer = await workbook.xlsx.writeBuffer();
    const response = await api.request("/api/import/xlsx", {
      method: "POST", headers: { cookie: cookieA }, body: new Uint8Array(buffer),
    });
    expect(response.status).toBe(201);
    const rows = await getDb().select().from(entries).where(eq(entries.date, "2026-10-03"));
    expect(rows).toEqual([expect.objectContaining({ userId: ownerA, projectId: "a-project", taskId: "a-task", minutes: 90 })]);
  });

  it("no session cannot access any private endpoint or forge an internal header", async () => {
    const attempts: [string, string, unknown?][] = [
      ["/api/projects", "GET"], ["/api/projects", "POST", { name: "bad" }],
      ["/api/projects/a-project", "PATCH", { name: "bad" }], ["/api/projects/a-project", "DELETE"],
      ["/api/projects/reset", "POST", { confirm: "CLEAR_MANUAL_DATA" }],
      ["/api/tasks", "GET"], ["/api/tasks", "POST", { projectId: "a-project", title: "bad" }],
      ["/api/tasks/a-task", "PATCH", { title: "bad" }], ["/api/tasks/a-task", "DELETE"],
      ["/api/tasks/reorder", "POST", { ids: ["a-task"] }],
      ["/api/entries", "GET"], ["/api/entries", "POST", {}], ["/api/entries/total", "GET"],
      ["/api/entries/a-entry", "PATCH", { minutes: 1 }], ["/api/entries/a-entry", "DELETE"],
      ["/api/entries/replace-cell", "POST", {}], ["/api/import", "POST", {}],
      ["/api/import/xlsx", "POST", {}], ["/api/import/template", "GET"],
      ["/api/export/xlsx", "GET"], ["/api/auth/me", "GET"], ["/api/auth/logout", "POST"],
    ];
    for (const [url, method, body] of attempts) {
      expect((await request(url, method, body, "")).status, `${method} ${url}`).toBe(401);
    }
    expect((await api.request("/api/projects", { headers: { "x-internal-key": process.env.SESSION_SECRET! } })).status).toBe(401);
    const remaining = await getDb().execute(sql`select count(*)::int as count from entries`);
    expect(remaining.rows[0]?.count).toBe(2);
  });
});
