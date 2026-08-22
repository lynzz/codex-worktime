# Codex Worktime

Generate privacy-safe, offline Codex worktime report foundations for a configured Project Profile.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

## Tracer bullet

The current tracer bullet accepts a Project Profile JSON file and a sanitized events JSON file, then writes a local SQLite event store and an offline HTML report:

```sh
npm start -- report \
  --profile profile.json \
  --events events.json \
  --database /path/to/application-data/analytics.sqlite \
  --output report.html
```

`profile.json` contains a stable project id, display name, and configured root ids/paths. Each sanitized event contains only an id, timestamp, Hook event type, current working directory, and optional session/turn ids. Extra fields are ignored and are never stored or rendered.

## Report views and reporting ranges

The default `internal` view is an offline audit report. It may show normalized, non-reversible provenance identities and data-quality warnings, but never raw project paths or private session content. The `customer` view has a stricter allowlist: project display name, Asia/Shanghai range, verified Active/Run totals, daily/weekly totals, Coverage, and Feature delivery evidence with Confidence. It excludes local paths, session/turn identities, event provenance, commit ids, Git remotes, prompts, transcripts, and tool data.

```sh
npm start -- report \
  --profile profile.json --events events.json \
  --database "$CODEX_WORKTIME_DATABASE" --output customer-report.html \
  --view customer --from 2026-08-01 --to 2026-08-31
```

All date boundaries are Asia/Shanghai. A date range clips verified interval totals at its local midnight boundaries. Feature-linked totals are rendered for a range only when their supplied attribution evidence carries that exact range; otherwise the report makes no feature-duration claim. Active and Run are verified event-bounded measurements. Feature mapping is inferred delivery evidence and always shows its Confidence; V1 does not include inferred human time. `no data` and `unknown` coverage are never zero-time claims.

## Incremental Hook ingestion

Use the same profile, database, and report output for Codex lifecycle Hook commands. The command accepts one Hook JSON payload on standard input, retains only the approved event metadata, and refreshes the same offline report:

```sh
printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"...","cwd":"/workspace/project"}' \
  | codex-worktime hook \
      --profile "$CODEX_WORKTIME_PROFILE" \
      --database "$CODEX_WORKTIME_DATABASE" \
      --output "$CODEX_WORKTIME_REPORT"
```

Configure Codex Hook lifecycle entries to invoke this command for the events needed by the report. Hook payloads may contain `transcript_path`, prompts, tool arguments, and other runtime metadata; this command deliberately ignores them. Replays are deduplicated from a stable lifecycle identity (and `tool_use_id` for tool lifecycle events), rather than the local arrival time. `SessionEnd` is retained as lifecycle metadata only and is not interpreted as active work duration.

This repository includes an enabled-project template at `.codex/hooks.json`, covering lifecycle, tool, compaction, and subagent events. The template uses synchronous, quiet commands so report writes remain ordered within a session and no Hook output enters the model context. Before Codex runs project Hooks, set `CODEX_WORKTIME_PROFILE`, `CODEX_WORKTIME_DATABASE`, and `CODEX_WORKTIME_REPORT` to absolute paths, then review and trust the Hook definition through Codex’s `/hooks` command. Codex’s Hook documentation describes project-level `hooks.json`, Hook standard input, and its trust review flow.

## Local data lifecycle

Keep the analytics database, real Project Profile configuration, and attribution-overrides store in a user application-data directory outside every analysed repository. Backups are manual, local copies; no automatic local or cloud backup occurs. Both lifecycle commands require every application-owned target explicitly, reject targets or backup outputs within a supplied Project Profile root, and do not print those paths.

```sh
# Copy selected local analytics/configuration/override files.
npm start -- data backup \
  --data-dir "$CODEX_WORKTIME_DATA_DIR" \
  --path "$CODEX_WORKTIME_DATABASE" "$CODEX_WORKTIME_PROFILE" "$CODEX_WORKTIME_OVERRIDES" \
  --project-root /absolute/path/to/analysed-project \
  --output /absolute/path/to/private-backup

# Delete only the listed application-owned files. Exported HTML remains untouched.
npm start -- data delete \
  --data-dir "$CODEX_WORKTIME_DATA_DIR" \
  --path "$CODEX_WORKTIME_DATABASE" "$CODEX_WORKTIME_PROFILE" "$CODEX_WORKTIME_OVERRIDES" \
  --project-root /absolute/path/to/analysed-project \
  --retained-export /absolute/path/to/exported-report.html \
  --confirm DELETE_LOCAL_DATA
```
