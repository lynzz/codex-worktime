# ADR-0004: Local analysis and portable, privacy-filtered monthly snapshots

## Status

Accepted — 2026-10-02; spec #23, deliveries #24–#29. Amended after user acceptance to include hosted one-click generation through an authorized local Report Collector.

## Context

The existing Chinese offline reports need to be available in the manual-timesheet Web app, with durable month-by-project retrieval. Cloudflare Workers cannot read the user's local Git repositories, assistant histories or native SQLite store. ADR-0001 restricted delivery to offline HTML and disallowed all Git-derived durations; the requested Web reports and visibly non-verified commit estimates require an explicit policy change.

## Decision

- Collection and analysis stay on the user's Node.js host. Raw Codex/Claude/Cursor histories are scanned read-only; normalized events and registered Project Profiles stay in local application data outside analysed roots. No raw source or native analyzer dependency is packaged into the Worker.
- A portable `report-core` contract contains only versioned, Zod-whitelisted Snapshot fields. The local shared builder emits JSON and HTML from the same Snapshot; HTML rendering can consume a Snapshot without scanning or opening SQLite.
- **This supersedes ADR-0001's offline-only report delivery policy:** privacy-filtered Snapshots are persisted in owner-isolated Neon tables and queried from the existing authenticated Web. It does not authorize raw event/history upload. CLI export remains local; authenticated Web generation and import explicitly save the portable contract.
- **This supersedes ADR-0001's blanket prohibition of Git-derived duration only for a separate Commit Cadence Estimate.** Deduplicate commits by hash, order actual author instants, and charge positive gaps only between immediately consecutive commits in the same Commit Group, capped at 3,600,000 ms. Attribute each gap to the later commit's Shanghai date. Do not charge the first commit or bridge a group change. A Group is a scope or matching unscoped subject, never a real Feature.
- A preceding commit before the month may supply cadence context, but only the later in-month commit and its attributed gap enter the Snapshot. Prior-month titles/counts are not exported. Customer HTML remains ADR-0001's minimum-field projection: no source provenance, commit counts/subjects/Groups or estimates.
- Verified Active/Run, Commit Cadence Estimate and Human-declared Entry remain three independent measures. They are never summed into one work-hour claim. Git timestamps do not affect verified accounting; Feature association still requires Attribution Evidence.
- Snapshot schema v2 fixes full-month Shanghai boundaries, algorithm version `event-union-v1+commit-cadence-ms-v2`, integer milliseconds, a complete ordered daily table, source counts, Coverage, and reason/count completeness diagnostics. Missing boundary evidence produces `null`, not a zero-time claim.
- Exact milliseconds preserve the current event-accounting precision. Hour labels round only for display (two decimals). Default pricing is CNY 120,000 cents per eight-hour day; multiply exact duration and round the final price to cents, never price a rounded display of person-days. Sub-minute commit gaps are retained rather than truncated as in the legacy minute estimator.
- Input Digest hashes canonical, deterministic business fields and excludes `generatedAt`. Commit ids serve local deduplication only; exported messages retain repeated-title counts and Group summaries/durations without ids.
- Every nested object is a strict whitelist. Text fields undergo conservative path/credential filtering, including quoted credential assignments and known private event values that reappear in commit titles. HTML markup is escaped as text. This is a defensive filter, not proof arbitrary prose is public: review an export before sharing it externally. Internal JSON is not a customer-approved projection.
- Cursor envelopes without usable timestamps are lifetime-only statistics, separate from monthly source counts. File mtimes never become synthetic timestamps or durations.
- Human-declared Entry storage and backup/reset remain governed by ADR-0003. No manual tables are modified by report generation. Manual reset and local AI deletion leave saved Snapshots and exported files intact; this delivery does not introduce report deletion or automatic retention.
- Manual Users authorize report mappings, runs, queries, imports and exports through their existing Login Session (ADR-0005). A mapping associates one existing owned manual project with a stable Profile ID without storing local roots or creating manual records.
- Complete immutable Snapshots and their daily rows commit atomically. Equivalent business digests converge under a unique key, excluding generation time; changed evidence or pricing produces a new version. Current-version ordering uses successful save time, then snapshot ID. A generated run succeeds in the same transaction as its complete Snapshot.
- Node hosts expose only their trusted account's registered Profiles. Each process incarnation atomically publishes its own local registration; recovery identifies dead or retired incarnations and never interrupts a live peer.
- **The hosted generation amendment supersedes the original cloud query/import-only composition.** An authenticated hosted Web creates a finite Report Run for a live, owner-matched Report Collector. The already running Node host receives and atomically claims the request through outbound Neon connections, performs collection locally, and atomically saves the complete Snapshot and successful run. No localhost page, CLI report command or manual file import is required.
- Collection Connections use database-clock leases and whitelisted Profile identifiers/display names, never roots or raw histories. Heartbeats continue during collection. Expired, closed or retired collectors cannot complete unfinished runs; interrupted work preserves prior snapshots and allows explicit retry. Workers retain no analyzer/native dependency and never scan a cloud or browser filesystem.
- This uses the existing report-run model for a narrow generation handoff, not a general-purpose distributed job system. Keeping an authorized local host online is a real prerequisite. An offline connection is shown explicitly, rather than presenting a disabled feature as successful deployment or requiring routine export/import. Outbound database handoff avoids exposing a public laptop endpoint or weakening same-origin browser security.
- Downloads render the selected saved Snapshot without rescanning. Explicit version selections, including pending navigation, take precedence over automatic opening of a completed run.

## Consequences

- Import, query, display and export share the portable contract without reimplementing accounting or parsing HTML.
- JSON is an independent, user-owned local export; CLI generation performs no upload, database migration, deployment or automatic backup. Explicit authenticated Web generation/import adds a saved Snapshot, not manual timesheet rows.
- Regenerating a month may change its digest as retained metadata or Git evidence changes. A digest is equivalence of normalized report content, not a hash of private raw sources.
- Unknown Coverage and incomplete sequences remain explicit even when some valid intervals exist. No report claims complete human effort from assistant or commit data.
