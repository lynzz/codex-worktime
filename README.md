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
