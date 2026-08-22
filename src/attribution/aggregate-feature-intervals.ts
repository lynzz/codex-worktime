export type VerifiedInterval = { id: string; activeMinutes: number; runMinutes: number };
export type FeatureIntervalLink = { featureId: string; intervalId: string; evidence: "reviewed-ticket" | "planning-reference" | "manual-review" };
export type FeatureIntervalTotal = { featureId: string; activeMinutes: number; runMinutes: number; evidenceCount: number };

export function aggregateFeatureIntervals(input: { intervals: readonly VerifiedInterval[]; links: readonly FeatureIntervalLink[] }): FeatureIntervalTotal[] {
  const intervals = new Map(input.intervals.map((interval) => [interval.id, interval]));
  const totals = new Map<string, FeatureIntervalTotal>();
  for (const link of input.links) {
    const interval = intervals.get(link.intervalId);
    if (!interval) continue;
    const total = totals.get(link.featureId) ?? { featureId: link.featureId, activeMinutes: 0, runMinutes: 0, evidenceCount: 0 };
    total.activeMinutes += interval.activeMinutes;
    total.runMinutes += interval.runMinutes;
    total.evidenceCount += 1;
    totals.set(link.featureId, total);
  }
  return [...totals.values()];
}
