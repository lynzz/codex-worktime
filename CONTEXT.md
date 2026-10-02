# Codex Worktime Context

Codex Worktime is a local tool for creating auditable reports of Codex usage for a logical project. It does not modify the analysed project.

## Ubiquitous language

- **Project Profile**: A logical project and its configured local roots. Roots are normalized to the profile without exposing full paths in reports.
- **Session**: A Codex main session. It is not a continuous work interval.
- **Turn**: A completed Codex work cycle bounded by `UserPromptSubmit` and `Stop`.
- **Active Interval**: The union of completed Turn intervals. It is the primary verified AI activity measure.
- **Run Interval**: The union of observable tool runs bounded by `PreToolUse` and `PostToolUse`. It is not a measure of unobservable model-only generation.
- **Feature**: A delivered product capability. It is not a Git commit scope.
- **Attribution Evidence**: The recorded evidence used to associate a Feature with delivery work.
- **Confidence**: The high, medium, or low strength of an Attribution Evidence claim.
- **Coverage**: Whether the tool has enough retained metadata to report a period. `available` means matching metadata was observed; `no-data` means a readable source covered the date but had no matching project metadata; `unknown` means the available sources cannot establish the date's coverage. Neither `no-data` nor `unknown` means zero hours.
- **Event completeness**: Whether an individual event sequence has the boundaries required to create a verified interval. It is separate from period-level Coverage.
- **Manual User**: A named owner of a private manual timesheet and saved Report Snapshots. A Manual User is not a Project Profile.
- **Login Session**: Authorization to access one Manual User's timesheet and reports. It is not an analysis Session or a work interval.
- **Human-declared Entry**: A user-recorded timesheet row for one calendar day (`{ date, projectId, title, minutes, taskId?, category?, note? }`). It is day-granular with no start/end times, lives in the Neon-hosted manual timesheet store, and is never merged into Active or Run Interval totals (ADR-0003).
- **Task Row**: A pre-configured (project, task title) pair pinned as a week-grid row. Entries link to it by id while keeping a title snapshot; deleting a Task Row preserves its entries.
- **Ad-hoc Entry**: A Human-declared Entry not linked to any Task Row, aggregated for display by project + title so that no recorded data disappears.
- **Report Snapshot**: An immutable, privacy-filtered report for one Project Profile and full Asia/Shanghai calendar month. Saved snapshots belong to a Manual User and retain fixed pricing. Verified metrics, Coverage and completeness, and non-verified estimates remain separate; raw sources and private identities are excluded.
- **Commit Cadence Estimate**: A non-verified estimate from immediately consecutive, deduplicated commits in the same grouping, capped at one hour per gap. It is not Active/Run time or Human-declared time; the first commit contributes no duration.
- **Commit Group**: A Conventional Commit scope, or a matching subject for unscoped commits. It groups delivery evidence but is not a Feature.
- **Input Digest**: A content identity for equivalent normalized Report Snapshots, independent of generation time. It does not identify private raw histories.
- **Undated Cursor Statistics**: Lifetime counts for transcript envelopes without usable timestamps. They cannot be assigned to a reporting month and never produce verified or estimated time.
- **Report Profile Mapping**: An explicit association between one existing owned manual project and a stable Project Profile identifier. It is not a name match and does not copy local roots.
- **Report Run**: A user's finite local report-generation attempt, progressing through queued/running to succeeded or failed. Success references a complete saved Report Snapshot; it is not a Run Interval.

## V1 boundary

The V1 accounting, privacy, storage, and reporting policy is defined by the ADRs in `docs/adr/`. Read the relevant ADR before changing any measurement, capture, persistence, or report behavior.
