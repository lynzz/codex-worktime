import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/index.js";

describe("hook command", () => {
  it("ingests a Hook payload and refreshes the same offline report without exposing transcript data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-hook-"));
    const profilePath = join(directory, "profile.json");
    const databasePath = join(directory, "analytics.sqlite");
    const htmlPath = join(directory, "report.html");
    await writeFile(
      profilePath,
      JSON.stringify({
        id: "demo-project",
        displayName: "Demo project",
        roots: [{ id: "root", path: "/workspace/demo" }]
      })
    );

    const originalDataDirectory = process.env.CODEX_WORKTIME_DATA_DIR;
    process.env.CODEX_WORKTIME_DATA_DIR = directory;
    try {
      const argv = [
        "node",
        "codex-worktime",
        "hook",
        "--profile",
        profilePath,
        "--database",
        databasePath,
        "--output",
        htmlPath,
        "--quiet"
      ];
      const runtime = {
        stdin: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "session-secret",
          turn_id: "turn-secret",
          tool_use_id: "TOOL_USE_ID_SENTINEL",
          agent_id: "AGENT_ID_SENTINEL",
          cwd: "/workspace/demo",
          transcript_path: "TRANSCRIPT_SENTINEL",
          prompt: "PROMPT_SENTINEL",
          reply: "REPLY_SENTINEL",
          tool_input: { command: "TOOL_INPUT_SENTINEL" },
          tool_response: "TOOL_OUTPUT_SENTINEL",
          git_remote: "GIT_REMOTE_SENTINEL",
          api_key: "API_KEY_SENTINEL"
        }),
        now: (() => {
          const timestamps = ["2026-08-22T01:00:00Z", "2026-08-22T01:05:00Z"];
          return () => timestamps.shift() ?? "2026-08-22T01:10:00Z";
        })()
      };

      await runCli(argv, runtime);
      await runCli(argv, runtime);
    } finally {
      if (originalDataDirectory === undefined) delete process.env.CODEX_WORKTIME_DATA_DIR;
      else process.env.CODEX_WORKTIME_DATA_DIR = originalDataDirectory;
    }

    const [html, database] = await Promise.all([readFile(htmlPath, "utf8"), readFile(databasePath, "utf8")]);
    expect(html).toContain("1 sanitized event");
    for (const sensitiveValue of [
      "TRANSCRIPT_SENTINEL",
      "PROMPT_SENTINEL",
      "REPLY_SENTINEL",
      "TOOL_INPUT_SENTINEL",
      "TOOL_OUTPUT_SENTINEL",
      "GIT_REMOTE_SENTINEL",
      "API_KEY_SENTINEL",
      "TOOL_USE_ID_SENTINEL",
      "AGENT_ID_SENTINEL",
      "/workspace/demo"
    ]) {
      expect(html).not.toContain(sensitiveValue);
      expect(database).not.toContain(sensitiveValue);
    }
  });

  it("recomputes tool-pair quality from persisted Hook events across incremental refreshes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-hook-"));
    const profilePath = join(directory, "profile.json");
    const databasePath = join(directory, "analytics.sqlite");
    const htmlPath = join(directory, "report.html");
    await writeFile(
      profilePath,
      JSON.stringify({
        id: "demo-project",
        displayName: "Demo project",
        roots: [{ id: "root", path: "/workspace/demo" }]
      })
    );

    const originalDataDirectory = process.env.CODEX_WORKTIME_DATA_DIR;
    process.env.CODEX_WORKTIME_DATA_DIR = directory;
    const argv = [
      "node",
      "codex-worktime",
      "hook",
      "--quiet",
      "--profile",
      profilePath,
      "--database",
      databasePath,
      "--output",
      htmlPath
    ];
    try {
      await runCli(argv, {
        stdin: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "session",
          turn_id: "turn",
          tool_use_id: "tool",
          cwd: "/workspace/demo"
        }),
        now: () => "2026-08-22T01:00:00Z"
      });
      await runCli(argv, {
        stdin: JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: "session",
          turn_id: "turn",
          tool_use_id: "tool",
          cwd: "/workspace/demo"
        }),
        now: () => "2026-08-22T01:01:00Z"
      });
    } finally {
      if (originalDataDirectory === undefined) delete process.env.CODEX_WORKTIME_DATA_DIR;
      else process.env.CODEX_WORKTIME_DATA_DIR = originalDataDirectory;
    }

    const html = await readFile(htmlPath, "utf8");
    expect(html).not.toContain("missing-tool-post");
    expect(html).not.toContain("unmatched-tool-post");
  });
});
