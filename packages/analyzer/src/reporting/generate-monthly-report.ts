import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { monthPeriod, type ReportSnapshot } from "@codex-worktime/report-core";
import { collectProjectReportSnapshot, generateProjectReport, projectProfileSchema } from "./generate-project-report.js";
import { importHistoricalJsonl } from "../history/import-historical-jsonl.js";
import { importClaudeCodeJsonl } from "../history/import-claude-code-jsonl.js";
import { importCursorTranscripts } from "../history/import-cursor-transcripts.js";
import { mergeCoverage } from "../history/merge-coverage.js";

async function discoverJsonl(directory: string): Promise<{ paths: string[]; incomplete: boolean }> {
  try {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    const results = await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name !== "subagents")
      .map((entry) => discoverJsonl(join(directory, entry.name))));
    return { paths: [...entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => join(directory, entry.name)), ...results.flatMap((result) => result.paths)].sort(),
      incomplete: results.some((result) => result.incomplete) };
  } catch { return { paths: [], incomplete: true }; }
}

export type MonthlyReportInput = {
  profileId: string; month: string; dataDirectory: string;
  eventsPath?: string; historyHome?: string; generatedAt?: string;
};

async function readMonthlyReportInput(input: MonthlyReportInput) {
  const profileId = z.string().regex(/^[a-z][a-z0-9_-]*$/).parse(input.profileId);
  const period = monthPeriod(input.month);
  const profilePath = join(input.dataDirectory, "profiles", `${profileId}.json`);
  const profile = projectProfileSchema.parse(JSON.parse(await readFile(profilePath, "utf8")));
  if (profile.id !== profileId) throw new Error("Registered Profile identity mismatch");
  const extraEvents = input.eventsPath ? z.array(z.unknown()).parse(JSON.parse(await readFile(input.eventsPath, "utf8"))) : [];
  const home = input.historyHome ?? homedir();
  const dateRange = { from: period.from, to: period.to };
  const codexFiles = await Promise.all(["sessions", "archived_sessions"].map((dir) => discoverJsonl(join(home, ".codex", dir))));
  const claudeFiles = await discoverJsonl(join(home, ".claude", "projects"));
  const cursorFiles = await Promise.all(profile.roots.map(async (root) => ({ root,
    ...await discoverJsonl(join(home, ".cursor", "projects", root.path.replace(/^\//u, "").replaceAll("/", "-"), "agent-transcripts"))
  })));
  const empty = { events: [], coverage: [], hasUnreadableSource: false };
  const codexPaths = codexFiles.flatMap((result) => result.paths);
  const codex = codexPaths.length ? await importHistoricalJsonl({ profile, paths: codexPaths, dateRange }) : empty;
  const claude = claudeFiles.paths.length ? await importClaudeCodeJsonl({ profile, paths: claudeFiles.paths, dateRange }) : empty;
  const cursorSources = cursorFiles.flatMap(({ root, paths }) => paths.map((path) => ({ path, cwd: root.path, sessionId: path })));
  const cursor = cursorSources.length ? await importCursorTranscripts({ sources: cursorSources, dateRange }) : {
    ...empty, undatedSessionCount: 0, undatedPromptCount: 0, undatedCompletedTurnCount: 0, missingTimestampCount: 0
  };
  const sourceStatus = {
    history: codex.hasUnreadableSource || codexFiles.some((result) => result.incomplete) || !codexPaths.length ? "unknown" : "available",
    "claude-history": claude.hasUnreadableSource || claudeFiles.incomplete || !claudeFiles.paths.length ? "unknown" : "available",
    "cursor-history": cursor.hasUnreadableSource || cursorFiles.some((result) => result.incomplete) || !cursorSources.length ? "unknown" : "available"
  } as const;
  return { profile, events: [...extraEvents, ...codex.events, ...claude.events, ...cursor.events],
    coverage: mergeCoverage([...codex.coverage, ...claude.coverage, ...cursor.coverage]),
    sourceStatus, cursorUndated: { scope: "lifetime-not-monthly" as const, sessionCount: cursor.undatedSessionCount,
      promptCount: cursor.undatedPromptCount, completedTurnCount: cursor.undatedCompletedTurnCount, missingTimestampCount: cursor.missingTimestampCount },
    month: period.month, generatedAt: input.generatedAt,
    databasePath: join(input.dataDirectory, `${profileId}.sqlite`), applicationDataDirectory: input.dataDirectory,
  };
}

/** Collect registered sources and existing SQLite Hook events without HTML/JSON files. */
export async function collectMonthlyReport(input: MonthlyReportInput): Promise<ReportSnapshot> {
  return collectProjectReportSnapshot(await readMonthlyReportInput(input));
}

export async function generateMonthlyReport(input: MonthlyReportInput & { htmlPath: string; jsonPath: string }) {
  const profileId = z.string().regex(/^[a-z][a-z0-9_-]*$/).parse(input.profileId);
  const profilePath = join(input.dataDirectory, "profiles", `${profileId}.json`);
  for (const path of [input.htmlPath, input.jsonPath]) {
    if ([profilePath, input.eventsPath].some((source) => source && resolve(path) === resolve(source))) throw new Error("Report output must not overwrite its input files");
  }
  return generateProjectReport({ ...await readMonthlyReportInput(input), htmlPath: input.htmlPath, jsonPath: input.jsonPath });
}
