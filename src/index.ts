import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { sanitizeHookEvent } from "./hooks/sanitize-hook-event.js";
import { generateProjectReport } from "./reporting/generate-project-report.js";

type ReportCommandOptions = {
  profile: string;
  events: string;
  database: string;
  output: string;
};

type CliRuntime = {
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stdin?: string;
  now?: () => string;
};

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readHookPayload(runtime: CliRuntime): Promise<unknown> {
  if (runtime.stdin !== undefined) {
    return JSON.parse(runtime.stdin) as unknown;
  }

  let payload = "";
  for await (const chunk of process.stdin) {
    payload += String(chunk);
  }
  return JSON.parse(payload) as unknown;
}

type HookCommandOptions = {
  profile: string;
  database: string;
  output: string;
  occurredAt?: string;
  quiet?: boolean;
};

export async function runCli(argv: string[], runtime: CliRuntime = {}): Promise<void> {
  const stdout = runtime.stdout ?? process.stdout;
  const program = new Command();
  program.name("codex-worktime").description("Generate privacy-safe local Codex worktime reports.");

  program
    .command("report")
    .description("Generate an offline report from a Project Profile and sanitized event JSON.")
    .requiredOption("--profile <path>", "Project Profile JSON file")
    .requiredOption("--events <path>", "sanitized event JSON file")
    .requiredOption("--database <path>", "local SQLite database path")
    .requiredOption("--output <path>", "offline HTML output path")
    .action(async (options: ReportCommandOptions) => {
      const result = await generateProjectReport({
        profile: await readJson(options.profile),
        events: await readJson(options.events),
        databasePath: options.database,
        htmlPath: options.output
      });
      stdout.write(
        `${JSON.stringify({ matchedEventCount: result.matchedEventCount, coverage: result.coverage })}\n`
      );
    });

  program
    .command("hook")
    .description("Ingest one Codex Hook JSON payload from standard input and refresh its offline report.")
    .requiredOption("--profile <path>", "Project Profile JSON file")
    .requiredOption("--database <path>", "local SQLite database path")
    .requiredOption("--output <path>", "offline HTML output path")
    .option("--occurred-at <timestamp>", "event timestamp; defaults to the current UTC time")
    .option("--quiet", "do not write ingestion output to standard output")
    .action(async (options: HookCommandOptions) => {
      const event = sanitizeHookEvent(
        await readHookPayload(runtime),
        options.occurredAt ?? runtime.now?.() ?? new Date().toISOString()
      );
      const result = await generateProjectReport({
        profile: await readJson(options.profile),
        events: [event],
        databasePath: options.database,
        htmlPath: options.output
      });
      if (!options.quiet) {
        stdout.write(
          `${JSON.stringify({ matchedEventCount: result.matchedEventCount, coverage: result.coverage })}\n`
        );
      }
    });

  await program.parseAsync(argv, { from: "node" });
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  runCli(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown command failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
