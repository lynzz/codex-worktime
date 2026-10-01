import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/index.js";

describe("report command", () => {
  it("generates an offline report from Project Profile and sanitized event JSON files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-cli-"));
    const profilePath = join(directory, "profile.json");
    const eventsPath = join(directory, "events.json");
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
    await writeFile(
      eventsPath,
      JSON.stringify([
        {
          id: "event-1",
          occurredAt: "2026-08-22T01:00:00Z",
          type: "UserPromptSubmit",
          cwd: "/workspace/demo",
          prompt: "CLI_PROMPT_SENTINEL",
          assistantReply: "CLI_ASSISTANT_SENTINEL",
          transcriptPath: "CLI_TRANSCRIPT_SENTINEL",
          toolArguments: "CLI_ARGUMENTS_SENTINEL",
          toolOutput: "CLI_OUTPUT_SENTINEL",
          apiKey: "CLI_API_KEY_SENTINEL",
          token: "CLI_TOKEN_SENTINEL",
          gitRemote: "CLI_REMOTE_SENTINEL"
        }
      ])
    );

    const originalDataDirectory = process.env.CODEX_WORKTIME_DATA_DIR;
    process.env.CODEX_WORKTIME_DATA_DIR = directory;
    let output = "";
    try {
      await runCli([
        "node",
        "codex-worktime",
        "report",
        "--profile",
        profilePath,
        "--events",
        eventsPath,
        "--database",
        databasePath,
        "--output",
        htmlPath
      ], {
        stdout: {
          write: (chunk: string) => {
            output += chunk;
            return true;
          }
        }
      });
    } finally {
      if (originalDataDirectory === undefined) {
        delete process.env.CODEX_WORKTIME_DATA_DIR;
      } else {
        process.env.CODEX_WORKTIME_DATA_DIR = originalDataDirectory;
      }
    }

    expect(await readFile(htmlPath, "utf8")).toContain("Demo project");
    expect(output).toContain('"coverage":"available"');
    expect(output).not.toContain("/workspace/demo");
    expect(output).not.toContain("CLI_PROMPT_SENTINEL");
    expect(output).not.toContain("CLI_ASSISTANT_SENTINEL");
    expect(output).not.toContain("CLI_TRANSCRIPT_SENTINEL");
    expect(output).not.toContain("CLI_ARGUMENTS_SENTINEL");
    expect(output).not.toContain("CLI_OUTPUT_SENTINEL");
    expect(output).not.toContain("CLI_API_KEY_SENTINEL");
    expect(output).not.toContain("CLI_TOKEN_SENTINEL");
    expect(output).not.toContain("CLI_REMOTE_SENTINEL");
  });
});
