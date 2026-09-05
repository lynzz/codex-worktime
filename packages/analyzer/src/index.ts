import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { sanitizeHookEvent } from "./hooks/sanitize-hook-event.js";
import { backupLocalData, deleteLocalData } from "./lifecycle/manage-local-data.js";
import { generateProjectReport } from "./reporting/generate-project-report.js";

type ReportCommandOptions = {
  profile: string;
  events: string;
  database: string;
  output: string;
  view?: "internal" | "customer";
  from?: string;
  to?: string;
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
  view?: "internal" | "customer";
  from?: string;
  to?: string;
};

type LocalDataCommandOptions = {
  dataDir: string;
  path: string[];
  projectRoot: string[];
  output?: string;
  retainedExport: string[];
  confirm?: string;
};

function dateRangeFromOptions(options: { from?: string; to?: string }): { from: string; to: string } | undefined {
  if (!options.from && !options.to) return undefined;
  if (!options.from || !options.to) throw new Error("Provide both --from and --to for a reporting date range");
  return { from: options.from, to: options.to };
}

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
    .option("--view <internal|customer>", "approved report audience", "internal")
    .option("--from <YYYY-MM-DD>", "Asia/Shanghai reporting-range start")
    .option("--to <YYYY-MM-DD>", "Asia/Shanghai reporting-range end")
    .action(async (options: ReportCommandOptions) => {
      const result = await generateProjectReport({
        profile: await readJson(options.profile),
        events: await readJson(options.events),
        databasePath: options.database,
        htmlPath: options.output,
        view: options.view,
        dateRange: dateRangeFromOptions(options)
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
    .option("--view <internal|customer>", "approved report audience", "internal")
    .option("--from <YYYY-MM-DD>", "Asia/Shanghai reporting-range start")
    .option("--to <YYYY-MM-DD>", "Asia/Shanghai reporting-range end")
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
        htmlPath: options.output,
        view: options.view,
        dateRange: dateRangeFromOptions(options)
      });
      if (!options.quiet) {
        stdout.write(
          `${JSON.stringify({ matchedEventCount: result.matchedEventCount, coverage: result.coverage })}\n`
        );
      }
    });

  const manual = program.command("manual").description("Manual human-declared timesheet (ADR-0003).");
  manual
    .command("import")
    .description("Idempotently import a prototype timesheet JSON into the Neon manual store.")
    .argument("<file>", "prototype timesheet JSON file")
    .action(async (file: string) => {
      const { importPrototypeTimesheet } = await import("./manual/import-prototype.js");
      const result = await importPrototypeTimesheet(await readJson(file));
      stdout.write(`${JSON.stringify(result)}\n`);
    });

  const data = program.command("data").description("Back up or delete explicitly declared application-owned local data.");
  data
    .command("backup")
    .description("Copy explicit application-data files to a user-selected backup directory.")
    .requiredOption("--data-dir <path>", "user application-data directory")
    .requiredOption("--path <paths...>", "explicit application-owned paths to back up")
    .requiredOption("--project-root <paths...>", "configured Project Profile root; may be repeated")
    .requiredOption("--output <path>", "backup directory outside configured project roots")
    .action(async (options: LocalDataCommandOptions) => {
      const result = await backupLocalData({
        applicationDataDirectory: options.dataDir,
        ownedPaths: options.path,
        projectRoots: options.projectRoot,
        backupDirectory: options.output!
      });
      stdout.write(`${JSON.stringify({ backedUpCount: result.backedUpPaths.length })}\n`);
    });

  data
    .command("delete")
    .description("Delete explicit application-owned local data; independent exports remain under user control.")
    .requiredOption("--data-dir <path>", "user application-data directory")
    .requiredOption("--path <paths...>", "explicit application-owned paths to delete")
    .requiredOption("--project-root <paths...>", "configured Project Profile root; may be repeated")
    .option("--retained-export <paths...>", "independent exports that are not deleted", [])
    .requiredOption("--confirm <value>", "type DELETE_LOCAL_DATA to confirm")
    .action(async (options: LocalDataCommandOptions) => {
      if (options.confirm !== "DELETE_LOCAL_DATA") throw new Error("Deletion requires --confirm DELETE_LOCAL_DATA");
      const result = await deleteLocalData({
        applicationDataDirectory: options.dataDir,
        ownedPaths: options.path,
        projectRoots: options.projectRoot,
        retainedExports: options.retainedExport
      });
      stdout.write(`${JSON.stringify({ deletedCount: result.deletedPaths.length, retainedExportCount: result.retainedExports.length })}\n`);
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
