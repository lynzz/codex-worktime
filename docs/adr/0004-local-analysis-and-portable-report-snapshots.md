# ADR-0004: Local analysis and portable, privacy-filtered monthly snapshots

## Status

Accepted — 2026-10-02; spec #23, first delivery #24.

## Context

The existing Chinese offline reports need to be available in the manual-timesheet Web app, with durable month-by-project retrieval. Cloudflare Workers cannot read the user's local Git repositories, assistant histories or native SQLite store. ADR-0001 restricted delivery to offline HTML and disallowed all Git-derived durations; the requested Web reports and visibly non-verified commit estimates require an explicit policy change.

## Decision

- Collection and analysis stay on the user's Node.js host. Raw Codex/Claude/Cursor histories are scanned read-only; normalized events and registered Project Profiles stay in local application data outside analysed roots. No raw source or native analyzer dependency is packaged into the Worker.
- A portable `report-core` contract contains only versioned, Zod-whitelisted Snapshot fields. The local shared builder emits JSON and HTML from the same Snapshot; HTML rendering can consume a Snapshot without scanning or opening SQLite.
- **This supersedes ADR-0001's offline-only report delivery policy:** subsequent tickets may persist these privacy-filtered Snapshots in owner-isolated Neon tables and query them from the existing Web. It does not authorize raw event/history upload. #24 exports locally only; cloud persistence and authentication remain separate tickets.
- **This supersedes ADR-0001's blanket prohibition of Git-derived duration only for a separate Commit Cadence Estimate.** Deduplicate commits by hash, order actual author instants, and charge positive gaps only between immediately consecutive commits in the same Commit Group, capped at 3,600,000 ms. Attribute each gap to the later commit's Shanghai date. Do not charge the first commit or bridge a group change. A Group is a scope or matching unscoped subject, never a real Feature.
- A preceding commit before the month may supply cadence context, but only the later in-month commit and its attributed gap enter the Snapshot. Prior-month titles/counts are not exported. Customer HTML remains ADR-0001's minimum-field projection: no source provenance, commit counts/subjects/Groups or estimates.
- Verified Active/Run, Commit Cadence Estimate and Human-declared Entry remain three independent measures. They are never summed into one work-hour claim. Git timestamps do not affect verified accounting; Feature association still requires Attribution Evidence.
- Snapshot schema v1 fixes full-month Shanghai boundaries, algorithm version `event-union-v1+commit-cadence-ms-v2`, integer milliseconds, a complete ordered daily table, source counts, Coverage, and reason/count completeness diagnostics. Missing boundary evidence produces `null`, not a zero-time claim.
- Exact milliseconds preserve the current event-accounting precision. Hour labels round only for display (two decimals). Default pricing is CNY 120,000 cents per eight-hour day; multiply exact duration and round the final price to cents, never price a rounded display of person-days. Sub-minute commit gaps are retained rather than truncated as in the legacy minute estimator.
- Input Digest hashes canonical, deterministic business fields and excludes `generatedAt`. Commit ids serve local deduplication only; exported messages retain repeated-title counts and Group summaries/durations without ids.
- Every nested object is a strict whitelist. Text fields undergo conservative path/credential filtering, including known private event values that reappear in commit titles. HTML markup is escaped as text. This is a defensive filter, not proof arbitrary prose is public: review an export before sharing it externally. Internal JSON is not a customer-approved projection.
- Cursor envelopes without usable timestamps are lifetime-only statistics, separate from monthly source counts. File mtimes never become synthetic timestamps or durations.
- Human-declared Entry storage and backup/reset remain governed by ADR-0003. No manual tables are modified by report generation. Cloud Snapshots will have their own retention/deletion operations.

## Consequences

- Later import/query/display tickets can depend on the portable contract without reimplementing accounting or parsing HTML.
- JSON is an independent, user-owned local export; generation performs no upload, database migration, deployment or automatic backup.
- Regenerating a month may change its digest as retained metadata or Git evidence changes. A digest is equivalence of normalized report content, not a hash of private raw sources.
- Unknown Coverage and incomplete sequences remain explicit even when some valid intervals exist. No report claims complete human effort from assistant or commit data.
