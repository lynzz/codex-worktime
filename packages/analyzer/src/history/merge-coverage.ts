import type { CoverageEntry } from "../reporting/generate-project-report.js";

const statusRank = { "no-data": 1, unknown: 2, available: 3 } as const;

export function mergeCoverage(entries: readonly CoverageEntry[]): CoverageEntry[] {
  const merged = new Map<string, CoverageEntry["status"]>();
  for (const entry of entries) {
    const previous = merged.get(entry.date);
    if (!previous || statusRank[entry.status] > statusRank[previous]) merged.set(entry.date, entry.status);
  }
  return [...merged.entries()].map(([date, status]) => ({ date, status })).sort((left, right) => left.date.localeCompare(right.date));
}
