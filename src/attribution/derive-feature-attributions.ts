export type Confidence = "high" | "medium" | "low";
export type Evidence = "explicit-ticket" | "planning-reference" | "branch" | "merge-subject" | "commit-subject" | "path" | "semantic";

export type Feature = { id: string; name: string; ticketRefs?: string[]; planningRefs?: string[]; branches?: string[]; keywords?: string[] };
export type CommitEvidence = { id: string; subject: string; scope?: string; paths?: string[]; ticketRefs?: string[]; planningRefs?: string[]; branch?: string; isMerge?: boolean; authoredAt?: string; committedAt?: string };
export type FeatureAttribution = { featureId: string; featureName: string; commitId: string; evidence: Evidence; confidence: Confidence; suggested: boolean };

function includesAny(value: string, candidates: readonly string[] | undefined): boolean {
  return candidates?.some((candidate) => value.toLowerCase().includes(candidate.toLowerCase())) ?? false;
}

function attributionFor(feature: Feature, commit: CommitEvidence): Omit<FeatureAttribution, "featureId" | "featureName" | "commitId"> | undefined {
  if (commit.isMerge) return undefined;
  if (commit.ticketRefs?.some((reference) => feature.ticketRefs?.includes(reference))) return { evidence: "explicit-ticket", confidence: "high", suggested: false };
  if (commit.planningRefs?.some((reference) => feature.planningRefs?.includes(reference))) return { evidence: "planning-reference", confidence: "high", suggested: false };
  if (includesAny(commit.branch ?? "", feature.branches)) return { evidence: "branch", confidence: "medium", suggested: false };
  if (includesAny(commit.subject, [feature.id, feature.name])) return { evidence: "commit-subject", confidence: "medium", suggested: false };
  if (commit.paths?.some((path) => includesAny(path, feature.keywords))) return { evidence: "path", confidence: "low", suggested: true };
  if (includesAny(commit.subject, feature.keywords)) return { evidence: "semantic", confidence: "low", suggested: true };
  return undefined;
}

export function deriveFeatureAttributions(input: { features: readonly Feature[]; commits: readonly CommitEvidence[] }): FeatureAttribution[] {
  const result: FeatureAttribution[] = [];
  for (const feature of input.features) {
    for (const commit of input.commits) {
      const attribution = attributionFor(feature, commit);
      if (attribution) result.push({ featureId: feature.id, featureName: feature.name, commitId: commit.id, ...attribution });
    }
  }
  return result;
}
