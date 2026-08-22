# ADR-0002: Build V1 with TypeScript on Node.js

## Status

Accepted — 2026-08-22

## Context

The maintainer works primarily with Node.js. The tool needs a portable local CLI, deterministic JSONL processing, local SQLite persistence, timezone-safe calculations, offline HTML generation, and fixture-driven tests.

## Decision

Build V1 with TypeScript on a supported Node.js LTS release.

- **Commander** provides the CLI and Hook command entry points.
- **better-sqlite3** provides local SQLite persistence.
- **Zod** validates Project Profiles and normalized Hook/history event inputs at the boundary.
- **@js-temporal/polyfill** handles instants, intervals, and Asia/Shanghai reporting boundaries.
- **Nunjucks** renders the self-contained offline HTML report.
- **Vitest** runs behavior-focused fixture and report tests.
- **tsx** executes TypeScript during development; the released CLI compiles to standard Node.js JavaScript.

## Consequences

- The first implementation remains a command-line tool rather than an Electron application, hosted web service, or Bun-specific runtime.
- Native SQLite binding compatibility is an explicit installation and CI concern.
- Tests exercise the public report-generation seam from sanitized events to output rather than internal persistence details.
