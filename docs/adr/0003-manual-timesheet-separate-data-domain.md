# ADR-0003: Manual human-declared timesheet as a separate data domain

## Status

Accepted — 2026-09-05

## Context

ADR-0001 excluded human-declared time from V1 pending an explicit policy change, and the original handoff left manual entry as an open question. A throwaway web prototype (branch `prototype/manual-time-entry`, issue #10) validated the interaction model with real daily use: three coequal views (week grid / day list / month calendar), a project + task-row model, and day-granular entries without start/end times. The implementation spec (#11) fixes the stack as TanStack Start + HeroUI + Hono + Drizzle on Neon serverless Postgres (project `little-silence-01813820`).

## Decision

- Manual work-hour entry is a first-class feature in its own data domain: the **Human-declared Entry** (人工补录). It is day-granular, and its store is the Neon-hosted manual timesheet database — physically separate from the local SQLite AI-event store.
- Manual totals are never merged into Active Interval or Run Interval totals. No view may present a single blended "hours" number across the two domains.
- The entry shape validated by the prototype is `{ id, date, projectId, title, minutes, taskId?, category?, note? }`: no start/end times, and `title` is a task-title snapshot that is not rewritten when a task row is renamed.
- Projects and task rows are user-configured fixed enums. Entries not linked to a task row remain visible as ad-hoc (散录) aggregations by project + title; deleting a task row preserves its entries.
- Backup and reset for this domain are in-app export (JSON/CSV), in-app clear-all, and `manual import`. The `data backup` / `data delete` commands continue to manage only the local AI-event store.
- Recording requires connectivity to Neon. Connectivity problems must surface as explicit errors (the health endpoint demonstrates the pattern); missing data is never rendered as zero hours.
- Presenting manual time in customer-facing report views requires a separate, explicit decision.

## Consequences

- The prototype's whole-state PUT is superseded by an incremental REST contract to prevent multi-tab overwrites.
- The ubiquitous language gains the Human-declared vocabulary recorded in `CONTEXT.md`.
- Network intermittency between the user's machine and Neon is an accepted trade-off, purchased for multi-device continuity and zero local-database maintenance.
