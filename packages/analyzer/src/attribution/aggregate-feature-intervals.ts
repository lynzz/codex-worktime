export type VerifiedInterval = { id: string; activeMinutes: number; runMinutes: number };
export type FeatureIntervalLink = { featureId: string; attributionCommitId: string; intervalId: string; evidence: "reviewed-ticket" | "planning-reference" | "manual-review" };
export type FeatureIntervalTotal = { featureId: string; activeMinutes: number; runMinutes: number; evidenceCount: number };

export function aggregateFeatureIntervals(input: { intervals: readonly VerifiedInterval[]; links: readonly FeatureIntervalLink[] }): FeatureIntervalTotal[] {
  const intervals = new Map(input.intervals.map((interval) => [interval.id, interval]));
  const totals = new Map<string, FeatureIntervalTotal>();
  const countedIntervals = new Set<string>();
  for (const link of input.links) {
    const interval = intervals.get(link.intervalId);
    if (!interval) continue;
    const total = totals.get(link.featureId) ?? { featureId: link.featureId, activeMinutes: 0, runMinutes: 0, evidenceCount: 0 };
    const key = `${link.featureId}:${link.intervalId}`;
    if (!countedIntervals.has(key)) {
      total.activeMinutes += interval.activeMinutes;
      total.runMinutes += interval.runMinutes;
      countedIntervals.add(key);
    }
    total.evidenceCount += 1;
    totals.set(link.featureId, total);
  }
  return [...totals.values()];
}
