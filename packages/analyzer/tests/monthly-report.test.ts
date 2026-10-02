import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { runCli } from "../src/index.js";
import { collectMonthlyReport, generateMonthlyReport } from "../src/reporting/generate-monthly-report.js";
import { calculateReportDigest, estimatedCostCents, renderReportSnapshot, reportBusinessJson, reportSnapshotSchema } from "@codex-worktime/report-core";
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
  expect(snapshot).toMatchObject({ schemaVersion: 2, project: { profileId: "demo", displayName: "测试项目" },
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
  await commit(root, 'fix(report): {"password":"QUOTED_PASSWORD"}', "2026-08-01T10:01:00+08:00");
  await commit(root, "fix(report): {'api-key':'QUOTED_API_KEY'}", "2026-08-01T10:02:00+08:00");
  const jsonPath = join(directory, "snapshot.json");
  const htmlPath = join(directory, "report.html");
  await generateProjectReport({ profile: { id: "demo", displayName: "隐私测试", roots: [{ id: "root", path: root }] },
    events: [{ id: "event-private", sessionId: "private-session", type: "SessionStart", occurredAt: "2026-08-01T01:00:00Z", cwd: root,
      nested: { apiKey: "PRIVATE_API_KEY", toolOutput: "PRIVATE_TOOL_OUTPUT" } }],
    sourceNotes: ["PRIVATE_TOOL_OUTPUT"], month: "2026-08", databasePath: join(directory, "events.sqlite"),
    applicationDataDirectory: directory, htmlPath, jsonPath });
  const json = await readFile(jsonPath, "utf8");
  const html = await readFile(htmlPath, "utf8");
  for (const secret of [root, "private-session", "PRIVATE_API_KEY", "PRIVATE_TOOL_OUTPUT", "/opt/private/repo", "RAW_TOKEN", "QUOTED_PASSWORD", "QUOTED_API_KEY"]) expect(json + html).not.toContain(secret);
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
    { schemaVersion: 1 }
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

it.each([["2026-02", 28], ["2024-02", 29], ["2026-04", 30], ["2026-08", 31]] as const)("collects the full %s calendar without output artifacts", async (month, count) => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-collect-"));
  await mkdir(join(directory, "profiles"));
  await writeFile(join(directory, "profiles", "demo.json"), JSON.stringify({
    id: "demo", displayName: "日历报告", roots: [{ id: "root", path: join(directory, "missing") }]
  }));
  const snapshot = await collectMonthlyReport({ profileId: "demo", month, dataDirectory: directory, historyHome: join(directory, "no-history") });
  expect(snapshot.days).toHaveLength(count);
  expect(snapshot.days[0].date).toBe(`${month}-01`);
  expect(snapshot.days.at(-1)?.date).toBe(`${month}-${count}`);
  expect(snapshot.weekly.every((week) => week.activeMs === null && week.runMs === null)).toBe(true);
  expect(snapshot.totals.activeMs).toBeNull();
  expect(snapshot.inputDigest).toBe(await calculateReportDigest(snapshot));
  await expect(readFile(join(directory, "report.html"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("restores actual Hook ingestion from SQLite through the output-free monthly collector", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-hook-"));
  await mkdir(join(directory, "profiles"));
  const profilePath = join(directory, "profiles", "demo.json");
  const root = join(directory, "workspace");
  await writeFile(profilePath, JSON.stringify({ id: "demo", displayName: "Hook 报告", roots: [{ id: "root", path: root }] }));
  const oldDataDirectory = process.env.CODEX_WORKTIME_DATA_DIR;
  process.env.CODEX_WORKTIME_DATA_DIR = directory;
  try {
    for (const [type, occurredAt] of [["UserPromptSubmit", "2026-08-01T01:00:00Z"], ["Stop", "2026-08-01T01:00:01.234Z"]]) {
      await runCli(["node", "cli", "hook", "--profile", profilePath, "--database", join(directory, "demo.sqlite"),
        "--output", join(directory, "hook.html"), "--occurred-at", occurredAt, "--quiet"], {
        stdin: JSON.stringify({ hook_event_name: type, session_id: "PRIVATE_HOOK_SESSION", turn_id: "PRIVATE_HOOK_TURN", cwd: root, prompt: "PRIVATE_HOOK_BODY" })
      });
    }
  } finally {
    if (oldDataDirectory === undefined) delete process.env.CODEX_WORKTIME_DATA_DIR;
    else process.env.CODEX_WORKTIME_DATA_DIR = oldDataDirectory;
  }
  const snapshot = await collectMonthlyReport({ profileId: "demo", month: "2026-08", dataDirectory: directory, historyHome: join(directory, "no-history") });
  expect(snapshot.sources).toContainEqual({ source: "hook", eventCount: 2, status: "available" });
  expect(snapshot.totals.activeMs).toBe(1234);
  expect(snapshot.days[0].activeMs).toBe(1234);
  expect(snapshot.weekly[0].activeMs).toBe(1234);
  for (const secret of [root, "PRIVATE_HOOK_SESSION", "PRIVATE_HOOK_TURN", "PRIVATE_HOOK_BODY"]) expect(JSON.stringify(snapshot)).not.toContain(secret);
});

it("saves real attribution evidence and only month-linked Feature durations, with stable business identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-feature-"));
  const jsonPath = join(directory, "snapshot.json");
  const htmlPath = join(directory, "report.html");
  await generateProjectReport({
    profile: { id: "demo", displayName: "归因报告", roots: [{ id: "root", path: join(directory, "missing") }] },
    events: [], month: "2026-08", databasePath: join(directory, "demo.sqlite"), applicationDataDirectory: directory, htmlPath, jsonPath,
    featureAttributions: [
      { featureId: "calendar", featureName: "月历 <b>显示</b>", commitId: "PRIVATE_ATTRIBUTION_COMMIT", evidence: "explicit-ticket", confidence: "high", suggested: false },
      { featureId: "draft", featureName: "候选功能", commitId: "PRIVATE_OTHER_COMMIT", evidence: "semantic", confidence: "low", suggested: true }
    ],
    featureIntervalTotals: [
      { featureId: "calendar", activeMinutes: 0.02056666666666667, runMinutes: 0.00205, evidenceCount: 1, dateRange: { from: "2026-08-01", to: "2026-08-31" } },
      { featureId: "draft", activeMinutes: 20, runMinutes: 10, evidenceCount: 1, dateRange: { from: "2026-07-01", to: "2026-07-31" } }
    ]
  });
  const snapshot = reportSnapshotSchema.parse(JSON.parse(await readFile(jsonPath, "utf8")));
  expect(snapshot.featureAttributions[0]).toMatchObject({ featureId: "calendar", evidence: "explicit-ticket", confidence: "high", suggested: false });
  expect(snapshot.featureIntervalTotals).toEqual([{ featureId: "calendar", activeMs: 1234, runMs: 123, evidenceCount: 1 }]);
  const html = renderReportSnapshot(snapshot);
  expect(html).toBe(await readFile(htmlPath, "utf8"));
  expect(html).toContain("月历 &lt;b&gt;显示&lt;/b&gt;");
  expect(html).toContain("明确票据");
  expect(html).toContain("建议，非确认归因");
  for (const secret of ["PRIVATE_ATTRIBUTION_COMMIT", "PRIVATE_OTHER_COMMIT"]) expect(JSON.stringify(snapshot) + html).not.toContain(secret);
  const reordered = Object.fromEntries(Object.entries(snapshot).reverse()) as typeof snapshot;
  reordered.generatedAt = "2026-10-03T00:00:00Z";
  reordered.inputDigest = "f".repeat(64);
  expect(reportBusinessJson(reordered)).toBe(reportBusinessJson(snapshot));
  expect(await calculateReportDigest(reordered)).toBe(snapshot.inputDigest);
  expect(estimatedCostCents(30000)).toBe(125);
  expect(reportSnapshotSchema.safeParse({ ...snapshot, featureAttributions: [{ ...snapshot.featureAttributions[0], commitId: "PRIVATE_ID" }] }).success).toBe(false);
  expect(reportSnapshotSchema.safeParse({ ...snapshot, weekly: [{ ...snapshot.weekly[0], activeMs: 1 }, ...snapshot.weekly.slice(1)] }).success).toBe(false);
});

it("exports all escaped commit titles with expandable overflow and the saved exact pricing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-messages-"));
  const root = join(directory, "root");
  await gitFixture(root);
  for (const [index, title] of ["feat(report): <script>text</script>", "feat(report): <script>text</script>", "fix(report): 第二条", "fix(report): 第三条", "fix(report): 第四条"].entries()) {
    await commit(root, title, `2026-08-01T09:00:${String(index * 10).padStart(2, "0")}+08:00`);
  }
  await mkdir(join(directory, "profiles"));
  await writeFile(join(directory, "profiles", "demo.json"), JSON.stringify({
    id: "demo", displayName: "展开报告", roots: [{ id: "root", path: root }, { id: "duplicate", path: root }]
  }));
  const snapshot = await collectMonthlyReport({ profileId: "demo", month: "2026-08", dataDirectory: directory, historyHome: join(directory, "no-history") });
  expect(snapshot.days[0].commitCount).toBe(5);
  expect(snapshot.days[0].commitMessages).toContainEqual({ title: "feat(report): <script>text</script>", count: 2 });
  expect(snapshot.days[0].commitEstimateMs).toBe(40000);
  const saved = { ...snapshot, rate: { ...snapshot.rate, dayRateCents: 240000 },
    totals: { ...snapshot.totals, estimatedCostCents: estimatedCostCents(40000, 240000) } };
  saved.inputDigest = await calculateReportDigest(saved);
  const html = renderReportSnapshot(saved);
  expect(html).toContain("&lt;script&gt;text&lt;/script&gt; × 2");
  expect(html).not.toContain("<script>");
  expect(html).toContain("<details><summary>展开其余 1 条提交信息</summary>");
  expect(html).toContain("第四条");
  expect(html).toContain("¥3.33");
  expect(html).toContain("¥2,400.00 / 人天");
  expect(await calculateReportDigest(saved)).not.toBe(snapshot.inputDigest);
});
