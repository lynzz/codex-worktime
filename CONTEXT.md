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
- **Coverage**: Whether the tool has enough retained metadata to report a period. Missing Coverage is “no data”, never zero hours.
- **Event completeness**: Whether an individual event sequence has the boundaries required to create a verified interval. It is separate from period-level Coverage.

## V1 boundary

The V1 accounting, privacy, storage, and reporting policy is defined by the ADRs in `docs/adr/`. Read the relevant ADR before changing any measurement, capture, persistence, or report behavior.
