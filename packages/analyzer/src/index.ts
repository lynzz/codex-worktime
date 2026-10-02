import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { sanitizeHookEvent } from "./hooks/sanitize-hook-event.js";
import { backupLocalData, deleteLocalData } from "./lifecycle/manage-local-data.js";
import { generateProjectReport } from "./reporting/generate-project-report.js";
import { generateMonthlyReport } from "./reporting/generate-monthly-report.js";
import { addUser, resetUserPassword, listUsers, findUserByUsername, claimOrphans, importPrototypeTimesheet } from "@codex-worktime/timesheet-server";
import { readManualPassword } from "./manual/password.js";
import { migrateManualAccounts } from "./manual/migrate.js";

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

  program.command("report-month")
    .description("Export a registered Project Profile's Shanghai month as HTML and versioned JSON.")
    .requiredOption("--profile-id <id>", "registered Project Profile id")
    .requiredOption("--month <YYYY-MM>", "full Asia/Shanghai month")
    .requiredOption("--data-dir <path>", "application data directory containing profiles/<id>.json")
    .requiredOption("--output <path>", "offline HTML output path")
    .requiredOption("--json-output <path>", "private snapshot JSON output path")
    .option("--events <path>", "additional sanitized event JSON file")
    .option("--history-home <path>", "history home directory; defaults to the current user's home")
    .action(async (options: { profileId: string; month: string; dataDir: string; output: string; jsonOutput: string; events?: string; historyHome?: string }) => {
      const result = await generateMonthlyReport({ profileId: options.profileId, month: options.month,
        dataDirectory: options.dataDir, htmlPath: options.output, jsonPath: options.jsonOutput,
        eventsPath: options.events, historyHome: options.historyHome, generatedAt: runtime.now?.() });
      stdout.write(`${JSON.stringify({ matchedEventCount: result.matchedEventCount, coverage: result.coverage })}\n`);
    });

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
  manual.command("migrate")
    .description("Apply staged manual-account and report migrations without deleting existing data.")
    .requiredOption("--phase <nullable|owned|reports>", "nullable before claiming; owned after claiming; reports afterward")
    .option("--adopt-existing-created-at", "record migration 0002 only after checking the already-existing column")
    .action(async (options: { phase: string; adoptExistingCreatedAt?: boolean }) => {
      stdout.write(`${JSON.stringify(await migrateManualAccounts(options.phase, options))}\n`);
    });
  manual
    .command("import")
    .description("Idempotently import a timesheet JSON into the named user's Neon manual store.")
    .argument("<file>", "prototype or exported timesheet JSON file")
    .requiredOption("--user <username>", "existing owner account")
    .action(async (file: string, options: { user: string }) => {
      const user = await findUserByUsername(options.user);
      if (!user) throw new Error("用户不存在");
      const result = await importPrototypeTimesheet(await readJson(file), user.id);
      stdout.write(`${JSON.stringify(result)}\n`);
    });

  const users = manual.command("user").description("Administer private manual timesheet accounts.");
  users.command("add").argument("<username>")
    .action(async (username: string) => {
      const result = await addUser(username, await readManualPassword());
      stdout.write(`${JSON.stringify(result)}\n`);
    });
  users.command("passwd").argument("<username>")
    .action(async (username: string) => {
      await resetUserPassword(username, await readManualPassword());
      stdout.write(`${JSON.stringify({ username, updated: true })}\n`);
    });
  users.command("list")
    .action(async () => {
      stdout.write(`${JSON.stringify(await listUsers())}\n`);
    });
  users.command("claim-orphans").argument("<username>")
    .action(async (username: string) => {
      stdout.write(`${JSON.stringify(await claimOrphans(username))}\n`);
    });

  manual
    .command("serve")
    .description("Start the manual timesheet web app (web build output; PORT/--port, default 8787).")
    .option("--port <number>", "listen port", (v: string) => Number(v))
    .action(async (options: { port?: number }) => {
      const { startManualServer, DEFAULT_MANUAL_SERVE_PORT } = await import("./manual/serve.js");
      const port = options.port ?? (Number(process.env.PORT ?? 0) || DEFAULT_MANUAL_SERVE_PORT);
      const child = startManualServer({ port, stdout });
      child.on("exit", (code) => {
        process.exit(code ?? 0);
      });
      await new Promise(() => {});
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
