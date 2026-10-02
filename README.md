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

## 月度 HTML / JSON 快照（#24）

在应用数据目录的 `profiles/<id>.json` 登记 Project Profile（`id`、`displayName`、`roots: [{ id, path }]`），再执行：

```sh
npm run analyzer -- report-month \
  --profile-id demo-project --month 2026-08 \
  --data-dir /path/to/application-data \
  --output /path/to/exports/demo-project-2026-08.html \
  --json-output /path/to/exports/demo-project-2026-08.json
```

命令复用该目录的 `<id>.sqlite` Hook 事件库，并只读扫描当前用户 `~/.codex/{sessions,archived_sessions}`、`~/.claude/projects` 和对应项目的 `~/.cursor/projects` 主会话记录。`--history-home <目录>` 可覆盖历史记录主目录；`--events <文件>` 可补充脱敏事件 JSON。月份按上海时区完整日历月处理，跨月区间按边界裁剪。

HTML 从同一份版本化 JSON 快照渲染，全部日明细、标题重复次数和 scope 分组保留。核验 AI 活跃、运行区间与提交节奏推测分开；无完整证据用 `null` / 无法确认，不填零工时。推测费用按精确时长以 1,200 元 / 8 小时计算，最终四舍五入到分。无时间戳 Cursor 记录仅计入“无法定月累计”。

快照不导出 roots、会话身份或原始事件内容；提交文本做保守隐私过滤并进行 HTML 转义。分享前仍需审核业务文本。此票仅提供本地导出，**尚未接入 Web 或上传 Neon**；后续 Web 票复用 `@codex-worktime/report-core` 的严格契约。算法/隐私政策见 ADR-0004。

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

## Manual timesheet (human-declared hours)

A local web app for recording outsourced, human-declared work hours by day — a separate data domain from the AI-time accounting above (ADR-0003); the two are never merged. Data lives in a Neon serverless Postgres project; the connection string is expected in `.env.local` at the repo root (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, written by `neon link`).

```sh
# One-time: build the web app, then start it on http://localhost:8787
npm run build -w @codex-worktime/web
npm run serve          # = codex-worktime manual serve; PORT / --port override

# Day-to-day development with hot reload
npm run dev:web
```

Three coequal views share one dataset: 周网格 (task-row × day grid, whole-cell replace), 日清单 (per-day entry list), 月历 (flat month overview with quick add). Hours accept `1.5` / `1:30` / `90m` / `1h30`. The 导出 XLSX button produces the EQA 平台任务清单 settlement workbook (rows sorted by date ascending, live 150 元/人时 cost formulas, bottom 合计 row with total hours and total cost). The 日期列填入日期 switch (`fillDates=1|0`) picks the grain: on → one row per date+project+title with the date filled; off → one row per project+title with the date column left blank; 导出 JSON dumps raw data.

Migrate recorded hours from the throwaway prototype:

```sh
npm run analyzer -- manual import /path/to/timesheet.PROTOTYPE-WIPE-ME.json
# → {"projects":{"inserted":N,"skipped":0},"tasks":{...},"entries":{...}}; re-running skips everything
```

Backup/reset for this domain are in-app export and the double-confirmed 清空 button in the ⚙ panel; `data backup`/`data delete` still manage only the local AI-event store.

## Deploy (Cloudflare Workers)

```sh
cd web
DEPLOY_TARGET=cloudflare npx vite build
CLOUDFLARE_API_TOKEN=... npx wrangler deploy   # DATABASE_URL 已在 worker secret
```

Live: https://gongshi-suji.lynzz168.workers.dev
Auth plan: Cloudflare Access on a custom domain (requires enabling Zero
Trust + a zone; workers.dev cannot be protected by Access policies).
