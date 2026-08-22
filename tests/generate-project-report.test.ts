import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateProjectReport } from "../src/reporting/generate-project-report.js";

const profile = {
  id: "eqa-platform",
  displayName: "EQA Platform",
  roots: [
    { id: "score", path: "/private/eqa/score" },
    { id: "charts", path: "/private/eqa/charts" }
  ]
};

describe("generateProjectReport", () => {
  it("unifies matching roots and produces a privacy-safe offline report", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const databasePath = join(outputDirectory, "analytics.sqlite");
    const htmlPath = join(outputDirectory, "report.html");

    const result = await generateProjectReport({
      profile,
      events: [
        {
          id: "event-1",
          occurredAt: "2026-08-22T01:00:00Z",
          type: "UserPromptSubmit",
          cwd: "/private/eqa/score",
          sessionId: "session-secret",
          turnId: "turn-secret",
          prompt: "PROMPT_SENTINEL",
          assistantReply: "ASSISTANT_REPLY_SENTINEL",
          transcriptPath: "TRANSCRIPT_PATH_SENTINEL",
          toolArguments: "TOOL_ARGUMENTS_SENTINEL",
          toolOutput: "TOOL_OUTPUT_SENTINEL",
          apiKey: "API_KEY_SENTINEL",
          token: "TOKEN_SENTINEL",
          gitRemote: "GIT_REMOTE_SENTINEL"
        },
        {
          id: "event-2",
          occurredAt: "2026-08-22T01:02:00Z",
          type: "Stop",
          cwd: "/private/eqa/charts",
          sessionId: "session-secret",
          turnId: "turn-secret",
          toolOutput: "TOOL_OUTPUT_SENTINEL"
        }
      ],
      featureAttributions: [
        { featureId: "billing", featureName: "Billing export", commitId: "commit-hash", evidence: "explicit-ticket", confidence: "high", suggested: false },
        { featureId: "search", featureName: "Search", commitId: "commit-hash-2", evidence: "semantic", confidence: "low", suggested: true }
      ],
      featureIntervalTotals: [
        { featureId: "billing", activeMinutes: 2, runMinutes: 1, evidenceCount: 1 }
      ],
      databasePath,
      htmlPath,
      applicationDataDirectory: outputDirectory
    });

    expect(result).toEqual({ matchedEventCount: 2, coverage: "available", htmlPath });

    const html = await readFile(htmlPath, "utf8");
    expect(html).toContain("EQA Platform");
    expect(html).toContain("数据可用");
    expect(html).toContain("活跃区间");
    expect(html).toContain("按日活跃、提交与覆盖情况");
    expect(html).toContain("2026-08-22");
    expect(html).toContain("Billing export");
    expect(html).toContain("明确票据");
    expect(html).toContain("低可信度建议");
    expect(html).toContain("2 分钟");
    expect(html).toContain('class="metric-grid"');
    expect(html).toContain('class="summary-table"');
    expect(html).toContain("已核验数据 · 汇总");
    expect(html).toContain("功能归因与已核验分钟");
    expect(html).toContain("已核验区间、提交节奏与数据覆盖");
    expect(html).toContain("提交节奏推测 · 按功能分组");
    expect(html).toContain("没有可推测的连续同功能提交");
    expect(html).not.toContain("推测总工时（非核验）");
    expect(html).toContain("未分配");
    expect(html).not.toContain("/private/eqa");
    const databaseContents = await readFile(databasePath, "latin1");
    const prohibitedValues = [
      "/private/eqa",
      "PROMPT_SENTINEL",
      "ASSISTANT_REPLY_SENTINEL",
      "TRANSCRIPT_PATH_SENTINEL",
      "TOOL_ARGUMENTS_SENTINEL",
      "TOOL_OUTPUT_SENTINEL",
      "API_KEY_SENTINEL",
      "TOKEN_SENTINEL",
      "GIT_REMOTE_SENTINEL"
    ];
    for (const value of prohibitedValues) {
      expect(html).not.toContain(value);
      expect(databaseContents).not.toContain(value);
    }
    expect(html).not.toContain("session-secret");

    expect(databaseContents.length).toBeGreaterThan(0);
  });

  it("marks an empty Project Profile as no data instead of zero time", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const htmlPath = join(outputDirectory, "report.html");

    const result = await generateProjectReport({
      profile,
      events: [],
      databasePath: join(outputDirectory, "analytics.sqlite"),
      htmlPath,
      applicationDataDirectory: outputDirectory
    });

    expect(result.coverage).toBe("no-data");
    expect(await readFile(htmlPath, "utf8")).toContain("无数据");
  });

  it("renders a customer-safe, Asia/Shanghai date-ranged view with verified, inferred, and no-data states", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const htmlPath = join(outputDirectory, "customer-report.html");

    await generateProjectReport({
      profile,
      events: [
        {
          id: "range-start",
          occurredAt: "2026-08-21T15:30:00Z",
          type: "UserPromptSubmit",
          cwd: "/private/eqa/score",
          sessionId: "PRIVATE_SESSION_SENTINEL",
          turnId: "turn"
        },
        {
          id: "range-stop",
          occurredAt: "2026-08-21T16:30:00Z",
          type: "Stop",
          cwd: "/private/eqa/score",
          sessionId: "PRIVATE_SESSION_SENTINEL",
          turnId: "turn"
        }
      ],
      coverage: [
        { date: "2026-08-22", status: "available" },
        { date: "2026-08-23", status: "no-data" }
      ],
      featureAttributions: [
        { featureId: "billing", featureName: "Billing export", commitId: "INTERNAL_COMMIT_SENTINEL", evidence: "semantic", confidence: "low", suggested: true }
      ],
      featureIntervalTotals: [{ featureId: "billing", activeMinutes: 30, runMinutes: 0, evidenceCount: 1, dateRange: { from: "2026-08-22", to: "2026-08-22" } }],
      view: "customer",
      dateRange: { from: "2026-08-22", to: "2026-08-22" },
      databasePath: join(outputDirectory, "analytics.sqlite"),
      htmlPath,
      applicationDataDirectory: outputDirectory
    });

    const html = await readFile(htmlPath, "utf8");
    expect(html).toContain("客户报告");
    expect(html).toContain("已核验数据");
    expect(html).toContain("推断的交付证据");
    expect(html).toContain("无数据与覆盖情况");
    expect(html).toContain("2026-08-22 至 2026-08-22 (Asia/Shanghai)");
    expect(html).toContain("30 分钟");
    expect(html).toContain("Billing export");
    expect(html).toContain("低可信度");
    expect(html).not.toContain("PRIVATE_SESSION_SENTINEL");
    expect(html).not.toContain("INTERNAL_COMMIT_SENTINEL");
    expect(html).not.toContain("sourceEventIds");
    expect(html).not.toContain("event ");
    expect(html).not.toContain("sanitized event");
    expect(html).not.toContain("parallel-machine");
    expect(html).not.toContain("union segment");
    expect(html).not.toContain("explicit evidence link");
  });

  it("does not claim data availability for a date range without matching metadata or intervals", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const htmlPath = join(outputDirectory, "range-without-data.html");
    const result = await generateProjectReport({
      profile,
      events: [{ id: "outside-range", occurredAt: "2026-08-20T01:00:00Z", type: "SessionStart", cwd: "/private/eqa/score" }],
      dateRange: { from: "2026-08-22", to: "2026-08-22" },
      databasePath: join(outputDirectory, "analytics.sqlite"),
      htmlPath,
      applicationDataDirectory: outputDirectory
    });

    expect(result.coverage).toBe("no-data");
    expect(await readFile(htmlPath, "utf8")).toContain("无数据");
  });

  it("requires an Asia/Shanghai date range for a customer report", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    await expect(generateProjectReport({
      profile,
      events: [],
      view: "customer",
      databasePath: join(outputDirectory, "analytics.sqlite"),
      htmlPath: join(outputDirectory, "customer.html"),
      applicationDataDirectory: outputDirectory
    })).rejects.toThrow("Customer reports require an Asia/Shanghai reporting date range");
  });

  it("preserves unknown coverage for an otherwise empty reporting range", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const result = await generateProjectReport({
      profile,
      events: [],
      coverage: [{ date: "2026-08-22", status: "unknown" }],
      dateRange: { from: "2026-08-22", to: "2026-08-22" },
      databasePath: join(outputDirectory, "analytics.sqlite"),
      htmlPath: join(outputDirectory, "unknown-range.html"),
      applicationDataDirectory: outputDirectory
    });

    expect(result.coverage).toBe("unknown");
  });

  it("ignores duplicate and invalid events while preserving valid data", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const htmlPath = join(outputDirectory, "report.html");

    const result = await generateProjectReport({
      profile,
      events: [
        {
          id: "event-1",
          occurredAt: "2026-08-22T01:00:00Z",
          type: "UserPromptSubmit",
          cwd: "/private/eqa/score",
          turnId: "turn-1"
        },
        {
          id: "event-1",
          occurredAt: "2026-08-22T01:00:00Z",
          type: "UserPromptSubmit",
          cwd: "/private/eqa/score",
          turnId: "turn-1"
        },
        {
          id: "event-3",
          occurredAt: "2026-08-22T01:01:00Z",
          type: "Stop",
          cwd: "/private/eqa/score",
          turnId: "turn-1"
        },
        {
          id: "event-2",
          occurredAt: "not-a-timestamp",
          type: "Stop",
          cwd: "/private/eqa/score"
        }
      ],
      databasePath: join(outputDirectory, "analytics.sqlite"),
      htmlPath,
      applicationDataDirectory: outputDirectory
    });

    expect(result.matchedEventCount).toBe(2);
    expect(await readFile(htmlPath, "utf8")).toContain("2 条脱敏事件");
    expect(await readFile(htmlPath, "utf8")).toContain("1 条数据质量警告");
    expect(await readFile(htmlPath, "utf8")).toContain("invalid-timestamp");
  });

  it("refuses to store analytics inside a configured project root", async () => {
    await expect(
      generateProjectReport({
        profile,
        events: [],
        databasePath: "/private/eqa/score/analytics.sqlite",
        htmlPath: "/tmp/report.html",
        applicationDataDirectory: "/private/eqa"
      })
    ).rejects.toThrow("outside configured project roots");
  });

  it("reports late and unclosed lifecycle event sequences without persisting their details", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const htmlPath = join(outputDirectory, "report.html");

    await generateProjectReport({
      profile,
      events: [
        {
          id: "late-post",
          occurredAt: "2026-08-22T01:00:00Z",
          type: "PostToolUse",
          cwd: "/private/eqa/score",
          sessionId: "session-1",
          turnId: "turn-1"
        },
        {
          id: "late-pre",
          occurredAt: "2026-08-22T01:01:00Z",
          type: "PreToolUse",
          cwd: "/private/eqa/score",
          sessionId: "session-1",
          turnId: "turn-1"
        },
        {
          id: "first-prompt",
          occurredAt: "2026-08-22T01:02:00Z",
          type: "UserPromptSubmit",
          cwd: "/private/eqa/score",
          sessionId: "session-1",
          turnId: "turn-2"
        },
        {
          id: "second-prompt",
          occurredAt: "2026-08-22T01:03:00Z",
          type: "UserPromptSubmit",
          cwd: "/private/eqa/score",
          sessionId: "session-1",
          turnId: "turn-3"
        }
      ],
      databasePath: join(outputDirectory, "analytics.sqlite"),
      htmlPath,
      applicationDataDirectory: outputDirectory
    });

    const html = await readFile(htmlPath, "utf8");
    expect(html).toContain("unmatched-tool-post");
    expect(html).toContain("missing-tool-post");
    expect(html).toContain("missing-turn-stop");
    expect(html).not.toContain("session-1");
  });

  it("matches tool lifecycle events by opaque tool invocation identity", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const htmlPath = join(outputDirectory, "report.html");

    await generateProjectReport({
      profile,
      events: [
        {
          id: "pre-one",
          occurredAt: "2026-08-22T01:00:00Z",
          type: "PreToolUse",
          cwd: "/private/eqa/score",
          sessionId: "session-1",
          turnId: "turn-1",
          toolUseId: "tool-one"
        },
        {
          id: "post-two",
          occurredAt: "2026-08-22T01:01:00Z",
          type: "PostToolUse",
          cwd: "/private/eqa/score",
          sessionId: "session-1",
          turnId: "turn-1",
          toolUseId: "tool-two"
        }
      ],
      databasePath: join(outputDirectory, "analytics.sqlite"),
      htmlPath,
      applicationDataDirectory: outputDirectory
    });

    const html = await readFile(htmlPath, "utf8");
    expect(html).toContain("unmatched-tool-post");
    expect(html).toContain("missing-tool-post");
  });

  it("serializes concurrent refreshes of the shared event store and offline report", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const databasePath = join(outputDirectory, "analytics.sqlite");
    const htmlPath = join(outputDirectory, "report.html");
    const sharedInput = { profile, databasePath, htmlPath, applicationDataDirectory: outputDirectory };

    await Promise.all([
      generateProjectReport({
        ...sharedInput,
        events: [{ id: "event-one", occurredAt: "2026-08-22T01:00:00Z", type: "SessionStart", cwd: "/private/eqa/score" }]
      }),
      generateProjectReport({
        ...sharedInput,
        events: [{ id: "event-two", occurredAt: "2026-08-22T01:01:00Z", type: "SessionEnd", cwd: "/private/eqa/score" }]
      })
    ]);

    expect(await readFile(htmlPath, "utf8")).toContain("2 条脱敏事件");
  });

  it("keeps stored invalid-timestamp warnings visible after a later refresh", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "codex-worktime-report-"));
    const databasePath = join(outputDirectory, "analytics.sqlite");
    const htmlPath = join(outputDirectory, "report.html");
    const sharedInput = { profile, databasePath, htmlPath, applicationDataDirectory: outputDirectory };

    await generateProjectReport({
      ...sharedInput,
      events: [{ id: "bad-time", occurredAt: "invalid", type: "Stop", cwd: "/private/eqa/score" }]
    });
    await generateProjectReport({
      ...sharedInput,
      events: [{ id: "valid", occurredAt: "2026-08-22T01:00:00Z", type: "SessionStart", cwd: "/private/eqa/score" }]
    });

    expect(await readFile(htmlPath, "utf8")).toContain("invalid-timestamp");
  });
});
