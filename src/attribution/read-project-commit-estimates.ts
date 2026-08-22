import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { estimateFeatureCommitTime, type CommitTimingEvidence, type FeatureCommitEstimate } from "./estimate-feature-commit-time.js";

const executeFile = promisify(execFile);

type ProjectRoot = { path: string };

function gitDateBoundary(date: string, boundary: "start" | "end"): string {
  return `${date}T${boundary === "start" ? "00:00:00" : "23:59:59"}+08:00`;
}

function parseGitLog(output: string): CommitTimingEvidence[] {
  return output.split("\u001e").flatMap((record) => {
    const [id, authoredAt, subject] = record.split("\u0000");
    return id && authoredAt && subject ? [{ id, authoredAt, subject }] : [];
  });
}

async function readRootCommits(root: ProjectRoot, dateRange: { from: string; to: string }): Promise<CommitTimingEvidence[]> {
  try {
    const { stdout } = await executeFile("git", [
      "-C", root.path,
      "log",
      "--no-merges",
      `--since=${gitDateBoundary(dateRange.from, "start")}`,
      `--until=${gitDateBoundary(dateRange.to, "end")}`,
      "--format=%H%x00%aI%x00%s%x1e"
    ], { maxBuffer: 10 * 1024 * 1024 });
    return parseGitLog(stdout);
  } catch {
    // A profile may include an unavailable or non-Git root. It simply has no
    // commit-based estimate and does not prevent an event-derived report.
    return [];
  }
}

export async function readProjectCommitEstimates(input: { roots: readonly ProjectRoot[]; dateRange: { from: string; to: string } }): Promise<FeatureCommitEstimate[]> {
  const commits = (await Promise.all(input.roots.map((root) => readRootCommits(root, input.dateRange)))).flat();
  return estimateFeatureCommitTime(commits);
}
