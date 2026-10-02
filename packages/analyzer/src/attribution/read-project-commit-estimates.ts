import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Temporal } from "@js-temporal/polyfill";

import { estimateFeatureCommitTime, summarizeCommitsByDay, summarizeEstimatedCommitTimeByDay, type CommitTimingEvidence, type DailyCommitEstimate, type DailyCommitSummary, type FeatureCommitEstimate } from "./estimate-feature-commit-time.js";

const executeFile = promisify(execFile);

type ProjectRoot = { path: string };

function parseGitLog(output: string): CommitTimingEvidence[] {
  return output.split("\u001e").flatMap((record) => {
    const [id, authoredAt, subject] = record.trim().split("\u0000");
    return id && authoredAt && subject ? [{ id, authoredAt, subject }] : [];
  });
}

async function readRootCommits(root: ProjectRoot, dateRange: { from: string; to: string }) {
  try {
    const { stdout } = await executeFile("git", [
      "-C", root.path,
      "log",
      "--no-merges",
      "--format=%H%x00%aI%x00%s%x1e"
    ], { maxBuffer: 10 * 1024 * 1024 });
    // Git's --since filters committer time, not %aI; filter the actual evidence
    // timestamp, including history rewritten/rebased outside this month.
    const dated = parseGitLog(stdout).map((commit) => ({ commit,
      date: Temporal.Instant.from(commit.authoredAt).toZonedDateTimeISO("Asia/Shanghai").toPlainDate().toString()
    }));
    const preceding = dated.filter((entry) => entry.date < dateRange.from)
      .sort((a, b) => Date.parse(b.commit.authoredAt) - Date.parse(a.commit.authoredAt) || b.commit.id.localeCompare(a.commit.id))[0];
    return { available: true, commits: [...(preceding ? [preceding.commit] : []), ...dated.filter(({ date }) => {
      return date >= dateRange.from && date <= dateRange.to;
    }).map(({ commit }) => commit)] };
  } catch {
    // A profile may include an unavailable or non-Git root. It simply has no
    // commit-based estimate and does not prevent an event-derived report.
    return { available: false, commits: [] };
  }
}

export type ProjectCommitReportData = {
  commits: CommitTimingEvidence[];
  available: boolean;
  estimates: FeatureCommitEstimate[];
  dailySummaries: DailyCommitSummary[];
  dailyEstimates: DailyCommitEstimate[];
};

export async function readProjectCommitReportData(input: { roots: readonly ProjectRoot[]; dateRange: { from: string; to: string } }): Promise<ProjectCommitReportData> {
  const results = await Promise.all(input.roots.map((root) => readRootCommits(root, input.dateRange)));
  const commits = results.flatMap((result) => result.commits);
  return {
    commits,
    available: results.every((result) => result.available),
    estimates: estimateFeatureCommitTime(commits, input.dateRange),
    dailySummaries: summarizeCommitsByDay(commits, input.dateRange),
    dailyEstimates: summarizeEstimatedCommitTimeByDay(commits, input.dateRange)
  };
}
