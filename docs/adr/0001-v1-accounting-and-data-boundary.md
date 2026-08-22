# ADR-0001: Use conservative, event-bounded V1 accounting and local-only data

## Status

Accepted — 2026-08-22

## Context

Codex Worktime must report defensible Codex use for one Project Profile without treating Git history, a Session's wall-clock lifetime, or missing historical records as time worked. Codex Hooks provide lifecycle and tool events, but the full transcript is not a stable hook interface and must remain outside the analytics data model.

## Decision

### Measurement

- A completed **Turn** starts at `UserPromptSubmit` and ends at `Stop`.
- The **Active Interval** is the wall-clock union of completed Turn intervals. The application never derives time from a Session's start/end span. Its idle-gap policy is zero minutes: it does not bridge gaps between Turns.
- An event sequence without a `Stop` has incomplete Event completeness and contributes no verified Active Interval. It produces a data-quality warning without changing period-level Coverage.
- The **Run Interval** is the union of observable `PreToolUse` to `PostToolUse` intervals. It represents tool execution or waiting only; model-only generation is not reported as a separately measured duration.
- A duplicate event is ignored using its normalized event identity. An unmatched or late `PostToolUse`, an invalid timestamp, a negative tool interval, or an out-of-order event creates no interval and produces a data-quality warning with only the normalized reason and event identity.
- A `PreToolUse` without a matching `PostToolUse` has incomplete Event completeness, creates no Run Interval, and produces the same data-quality warning without changing period-level Coverage.
- A later `UserPromptSubmit` before the preceding Turn's `Stop` leaves the earlier Turn incomplete. `SessionEnd`, a process interruption, or an application restart never synthesizes a missing `Stop`.
- Concurrent valid intervals are reduced to a wall-clock union for the primary total. A parallel-machine diagnostic may be shown separately and may never inflate the primary total.
- Duplicate lifecycle events and fork, resume, or compact lineage are de-duplicated before interval union. Subagent intervals participate in that same union and are never added as a second full duration; any subagent detail is diagnostic only.

### Scope and attribution

- Every configured project root maps to its Project Profile without appearing as a full path in reports.
- A legacy candidate root may be retained in a Project Profile only with an explicit `candidate` status. Candidate roots are excluded from the V1 primary total until their inclusion is approved.
- Git contributes Feature delivery evidence only. Git timestamps, commit gaps, and author timestamps must never influence duration calculations.
- Human-declared time and token collection are out of scope for V1.
- Attribution overrides are append-only user-level records. They preserve the original Attribution Evidence and are reversible.

### Privacy and storage

- The application stores only the minimum normalized fields necessary for Project Profile matching, event time/type, internal or non-reversible session and Turn identity, lineage, calculated intervals, Coverage, Attribution Evidence, and Confidence.
- The application must not persist or display prompts, assistant replies, transcript contents, tool parameters, tool output, credentials, tokens/secrets, Git remotes, or full local paths in customer-facing material.
- Raw history is scanned read-only and on demand. The analytics database, real Project Profile configuration, and attribution overrides live in user-level application data, outside the analysed repository.
- A sanitized Project Profile template may be committed to the tool repository; real local roots may not.
- Local data is retained until the user explicitly deletes it. V1 provides export and deletion commands and performs no automatic backup, local or cloud. An export is a user-chosen, independent artifact and is not deleted automatically.
- Deletion removes the analytics database, real Project Profile configuration, and attribution overrides owned by the application. It reports the independently exported artifacts that remain under the user's control.
- Privacy tests use sentinel values in every prohibited input field and prove those values are absent from the analytics database, generated HTML, command output, and application logs. Deletion tests prove the application-owned database, configuration, and overrides are removed.

### Reports and delivery

- V1 produces an internal offline HTML report only. Customer-facing reporting is deferred.
- Reports use Asia/Shanghai for date boundaries and support date-range, daily, weekly, and Feature aggregation.
- The V1 delivery form is a local CLI with an optional Codex Skill. It is not a Codex plugin.

## Consequences

- The report deliberately under-claims: unavailable retained history is visible as Missing Coverage, while incomplete Turn and tool event sequences are visible as Event completeness/data-quality warnings rather than estimates.
- A client cannot interpret the primary total as human effort, token consumption, or a complete measure of all model computation.
- Later work may add customer views, manual time, token accounting, or legacy-root inclusion only through an explicit policy change that preserves the separate metrics.
