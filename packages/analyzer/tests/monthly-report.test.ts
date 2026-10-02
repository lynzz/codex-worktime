import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { runCli } from "../src/index.js";
import { generateMonthlyReport } from "../src/reporting/generate-monthly-report.js";
import { reportSnapshotSchema } from "@codex-worktime/report-core";
import { generateProjectReport } from "../src/reporting/generate-project-report.js";

const exec = promisify(execFile);
async function gitFixture(root: string) {
  await mkdir(root);
  await exec("git", ["init", root]);
  await exec("git", ["-C", root, "config", "user.email", "fixture@example.test"]);
  await exec("git", ["-C", root, "config", "user.name", "Fixture"]);
}
async function commit(root: string, subject: string, date: string) {
  await exec("git", ["-C", root, "commit", "--allow-empty", "-m", subject], {
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  });
}

it("exports the registered Shanghai month as same-origin HTML and precise, private JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-report-"));
  const root = join(directory, "private-workspace");
  await gitFixture(root);
  for (const date of ["2026-08-01T09:00:00+08:00", "2026-08-01T09:00:30+08:00"]) {
    await commit(root, "feat(report): <b>中文汇总</b>", date);
  }
  await mkdir(join(directory, "profiles"));
  await writeFile(join(directory, "profiles", "demo.json"), JSON.stringify({
    id: "demo", displayName: "测试项目", roots: [{ id: "main", path: root }, { id: "duplicate-root", path: root }]
  }));
  const events = join(directory, "events.json");
  await writeFile(events, JSON.stringify([
    { id: "private-id", sessionId: "private-session", type: "UserPromptSubmit", cwd: root, occurredAt: "2026-07-31T15:59:59.900Z", prompt: "PRIVATE_PROMPT" },
    { id: "tool", sessionId: "private-session", toolUseId: "private-tool", type: "PreToolUse", cwd: root, occurredAt: "2026-07-31T16:00:00.100Z" },
    { id: "tool-end", sessionId: "private-session", toolUseId: "private-tool", type: "PostToolUse", cwd: root, occurredAt: "2026-07-31T16:00:00.223Z" },
    { id: "end", sessionId: "private-session", type: "Stop", cwd: root, occurredAt: "2026-07-31T16:00:01.234Z" }
  ]));
  const htmlPath = join(directory, "report.html");
  const jsonPath = join(directory, "report.json");
  let output = "";
  await runCli(["node", "cli", "report-month", "--profile-id", "demo", "--month", "2026-08", "--data-dir", directory,
    "--events", events, "--history-home", join(directory, "empty-home"), "--output", htmlPath, "--json-output", jsonPath], {
    now: () => "2026-10-02T00:00:00Z", stdout: { write: (chunk: string) => { output += chunk; return true; } }
  });
  const json = await readFile(jsonPath, "utf8");
  const snapshot = JSON.parse(json);
  expect(snapshot).toMatchObject({ schemaVersion: 1, project: { profileId: "demo", displayName: "测试项目" },
    period: { month: "2026-08", from: "2026-08-01", to: "2026-08-31", timeZone: "Asia/Shanghai" },
    totals: { activeMs: 1234, runMs: 123, commitEstimateMs: 30000, estimatedCostCents: 125 },
    rate: { currency: "CNY", dayRateCents: 120000, hoursPerDay: 8 }
  });
  expect(snapshot.days).toHaveLength(31);
  expect(snapshot.days[0]).toMatchObject({ date: "2026-08-01", activeMs: 1234, runMs: 123, commitCount: 2,
    commitMessages: [{ title: "feat(report): <b>中文汇总</b>", count: 2 }],
    commitGroups: [{ label: "report（提交 scope）", commitCount: 2, estimatedMs: 30000 }]
  });
  expect(snapshot.days[1]).toMatchObject({ coverage: "unknown", activeMs: null, runMs: null });
  const html = await readFile(htmlPath, "utf8");
  expect(html).toContain("&lt;b&gt;中文汇总&lt;/b&gt;");
  expect(html).toContain("0.01 小时");
  expect(html).toContain("¥1.25");
  expect(snapshot.inputDigest).toMatch(/^[a-f0-9]{64}$/);
  for (const secret of [root, "private-session", "PRIVATE_PROMPT", "private-tool"]) expect(json + output).not.toContain(secret);
});

it("redacts private text even when it reappears inside commit messages or grouping labels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-private-"));
  const root = join(directory, "private-root");
  await gitFixture(root);
  await commit(root, "feat(report): <script>private-session PRIVATE_API_KEY</script>", "2026-08-01T09:00:00+08:00");
  await commit(root, "fix(/opt/private/repo): token=RAW_TOKEN", "2026-08-01T10:00:00+08:00");
  const jsonPath = join(directory, "snapshot.json");
  const htmlPath = join(directory, "report.html");
  await generateProjectReport({ profile: { id: "demo", displayName: "隐私测试", roots: [{ id: "root", path: root }] },
    events: [{ id: "event-private", sessionId: "private-session", type: "SessionStart", occurredAt: "2026-08-01T01:00:00Z", cwd: root,
      nested: { apiKey: "PRIVATE_API_KEY", toolOutput: "PRIVATE_TOOL_OUTPUT" } }],
    sourceNotes: ["PRIVATE_TOOL_OUTPUT"], month: "2026-08", databasePath: join(directory, "events.sqlite"),
    applicationDataDirectory: directory, htmlPath, jsonPath });
  const json = await readFile(jsonPath, "utf8");
  const html = await readFile(htmlPath, "utf8");
  for (const secret of [root, "private-session", "PRIVATE_API_KEY", "PRIVATE_TOOL_OUTPUT", "/opt/private/repo", "RAW_TOKEN"]) expect(json + html).not.toContain(secret);
  expect(html).toContain("&lt;script&gt;");
  expect(JSON.parse(json).days[0].commitGroups.some((group: { label: string }) => group.label.includes("已脱敏"))).toBe(true);
});

it("uses pre-month commit context without exporting it, and keeps customer HTML Git-free", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-boundary-"));
  const root = join(directory, "root");
  await gitFixture(root);
  await commit(root, "feat(report): PRE_MONTH_SENTINEL", "2026-07-31T23:50:00+08:00");
  await commit(root, "fix(report): CUSTOMER_PRIVATE_COMMIT", "2026-08-01T00:10:00+08:00");
  const jsonPath = join(directory, "snapshot.json");
  const htmlPath = join(directory, "customer.html");
  await generateProjectReport({ profile: { id: "demo", displayName: "客户项目", roots: [{ id: "main", path: root }] },
    events: [], month: "2026-08", view: "customer", databasePath: join(directory, "events.sqlite"),
    applicationDataDirectory: directory, htmlPath, jsonPath });
  const json = await readFile(jsonPath, "utf8");
  const snapshot = JSON.parse(json);
  expect(snapshot.days[0]).toMatchObject({ commitCount: 1, commitEstimateMs: 1200000 });
  expect(snapshot.totals).toMatchObject({ commitEstimateMs: 1200000, estimatedCostCents: 5000 });
  expect(json).not.toContain("PRE_MONTH_SENTINEL");
  const html = await readFile(htmlPath, "utf8");
  for (const privateField of ["CUSTOMER_PRIVATE_COMMIT", "report（提交 scope）", "提交历史汇总", "Git 提交", "采集来源"]) expect(html).not.toContain(privateField);
});

it("imports local providers and keeps undated Cursor counts outside the reporting month", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-sources-"));
  const root = join(directory, "workspace");
  const historyHome = join(directory, "history");
  await mkdir(join(directory, "profiles"));
  await writeFile(join(directory, "profiles", "demo.json"), JSON.stringify({ id: "demo", displayName: "多来源项目", roots: [{ id: "main", path: root }] }));
  const claudePath = join(historyHome, ".claude", "projects", "demo");
  // Only archives are readable: retained records do not establish full source availability.
  const codexPath = join(historyHome, ".codex", "archived_sessions");
  const cursorPath = join(historyHome, ".cursor", "projects", root.replace(/^\//u, "").replaceAll("/", "-"), "agent-transcripts", "private-session");
  for (const path of [claudePath, codexPath, cursorPath]) await mkdir(path, { recursive: true });
  await writeFile(join(claudePath, "fixture.jsonl"), [
    { type: "user", timestamp: "2026-08-01T01:00:00Z", cwd: root, sessionId: "claude-private", message: { content: "PRIVATE_BODY" } },
    { type: "assistant", timestamp: "2026-08-01T01:00:30.123Z", cwd: root, sessionId: "claude-private", message: { stop_reason: "end_turn", content: "PRIVATE_REPLY" } }
  ].map((record) => JSON.stringify(record)).join("\n"));
  await writeFile(join(codexPath, "fixture.jsonl"), JSON.stringify({ type: "session_meta", timestamp: "2026-07-31T16:00:00Z", payload: { cwd: root, session_id: "codex-private" } }));
  await writeFile(join(cursorPath, "main.jsonl"), [
    { role: "user", content: "PRIVATE_CURSOR" }, { type: "turn_ended", status: "success" }
  ].map((record) => JSON.stringify(record)).join("\n"));
  const htmlPath = join(directory, "report.html");
  const jsonPath = join(directory, "report.json");
  const generate = (generatedAt: string) => generateMonthlyReport({ profileId: "demo", month: "2026-08", dataDirectory: directory, historyHome, htmlPath, jsonPath, generatedAt });
  await generate("2026-10-02T00:00:00Z");
  const json = await readFile(jsonPath, "utf8");
  const snapshot = reportSnapshotSchema.parse(JSON.parse(json));
  expect(snapshot.totals).toMatchObject({ activeMs: 30123, runMs: null, commitEstimateMs: null, estimatedCostCents: null });
  expect(snapshot.cursorUndated).toEqual({ scope: "lifetime-not-monthly", sessionCount: 1, promptCount: 1, completedTurnCount: 1, missingTimestampCount: 2 });
  expect(snapshot.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: "history", eventCount: 1, status: "unknown" }), expect.objectContaining({ source: "claude-history", eventCount: 2 }),
    expect.objectContaining({ source: "cursor-history", eventCount: 0 })
  ]));
  for (const secret of ["PRIVATE_BODY", "PRIVATE_REPLY", "PRIVATE_CURSOR", root, "claude-private", "codex-private"]) expect(json).not.toContain(secret);
  await generate("2026-10-03T00:00:00Z");
  expect(JSON.parse(await readFile(jsonPath, "utf8")).inputDigest).toBe(snapshot.inputDigest);
  expect(await readFile(htmlPath, "utf8")).toContain("无法定月累计");
});

it("keeps empty/incomplete inputs unknown and rejects malformed or non-whitelisted snapshot data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-empty-"));
  const jsonPath = join(directory, "snapshot.json");
  await generateProjectReport({ profile: { id: "demo", displayName: "无完整边界", roots: [{ id: "root", path: join(directory, "missing") }] },
    events: [{ id: "incomplete-private", type: "UserPromptSubmit", cwd: join(directory, "missing"), occurredAt: "2026-08-01T01:00:00Z" }],
    month: "2026-08", databasePath: join(directory, "events.sqlite"), applicationDataDirectory: directory,
    htmlPath: join(directory, "report.html"), jsonPath
  });
  const snapshot = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(snapshot.totals).toMatchObject({ activeMs: null, runMs: null, commitEstimateMs: null, estimatedCostCents: null });
  expect(snapshot.integrity).toContainEqual({ reason: "missing-turn-stop", count: 1 });
  expect(snapshot.days.every((day: { activeMs: number | null }) => day.activeMs === null)).toBe(true);
  expect(await readFile(join(directory, "report.html"), "utf8")).toContain("—（无法确认）");
  expect(reportSnapshotSchema.safeParse({ ...snapshot, roots: ["/private/root"] }).success).toBe(false);
  expect(reportSnapshotSchema.safeParse({ ...snapshot, project: { ...snapshot.project, token: "PRIVATE_TOKEN" } }).success).toBe(false);
  for (const title of ["read /opt/private/repo/config", "token=PRIVATE_TOKEN", "sk-supersecret-key", "file:///Users/private", "C:\\private\\secret"]) {
    const bad = structuredClone(snapshot);
    bad.days[0].commitMessages = [{ title, count: 1 }];
    expect(reportSnapshotSchema.safeParse(bad).success, title).toBe(false);
  }
  for (const change of [
    { period: { ...snapshot.period, from: "2026-07-31" } }, { days: snapshot.days.slice(1) },
    { totals: { ...snapshot.totals, activeMs: 0.1 } }, { totals: { ...snapshot.totals, estimatedCostCents: 200 } },
    { schemaVersion: 2 }
  ]) expect(reportSnapshotSchema.safeParse({ ...snapshot, ...change }).success).toBe(false);
  await expect(generateMonthlyReport({ profileId: "../private", month: "2026-08", dataDirectory: directory, htmlPath: "unused", jsonPath: "unused" })).rejects.toThrow();
  await expect(generateMonthlyReport({ profileId: "demo", month: "2026-13", dataDirectory: directory, htmlPath: "unused", jsonPath: "unused" })).rejects.toThrow();
});

it("reports unknown coverage through the public result when no sources establish the month", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-no-sources-"));
  const result = await generateProjectReport({ profile: { id: "demo", displayName: "无来源", roots: [{ id: "root", path: join(directory, "missing") }] },
    events: [], month: "2026-02", databasePath: join(directory, "events.sqlite"), applicationDataDirectory: directory,
    htmlPath: join(directory, "report.html"), jsonPath: join(directory, "snapshot.json") });
  expect(result.coverage).toBe("unknown");
  const snapshot = JSON.parse(await readFile(join(directory, "snapshot.json"), "utf8"));
  expect(snapshot.days).toHaveLength(28);
  expect(snapshot.days.every((day: { coverage: string }) => day.coverage === "unknown")).toBe(true);
});
