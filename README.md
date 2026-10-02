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

A local web app for recording outsourced, human-declared work hours by day — a separate data domain from the AI-time accounting above (ADR-0003); the two are never merged. Each Manual User owns a private set of projects, task rows, and entries (ADR-0005). Data lives in Neon serverless Postgres; `.env.local` holds `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and a strong random `SESSION_SECRET`. Authentication is always required; omitting the signing secret fails closed. The old shared `ACCESS_PASSWORD` and `x-internal-key` bypass are no longer supported.

### Non-destructive account migration

Stop the old application before migrating and retain a private database backup or an independent Neon backup branch. Rehearse on a separate branch first; destructive integration tests must use their own `NEON_TEST_DATABASE_URL`, never the production or rehearsal branch.

```sh
# A: nullable ownership; existing ids, dates, minutes, notes and links stay intact.
npm run analyzer -- manual migrate --phase nullable

# Create the account using a hidden terminal password prompt.
npm run analyzer -- manual user add lzz
npm run analyzer -- manual user claim-orphans lzz

# Verify the original rows and totals, then B: NOT NULL ownership and indexes.
npm run analyzer -- manual migrate --phase owned
```

`claim-orphans` only fills unowned rows. It validates the entire project/task/entry graph and claims all three tables in one transaction; inconsistent links roll back everything. Repeating it returns zero counts. Migration B refuses any remaining unowned rows without partially applying the phase. Neither phase uses reset, truncate, or deletion.

If the legacy database already has `entries.created_at` but migration `0002` is unrecorded, inspect its type, nullability, and default first, then explicitly run `manual migrate --phase nullable --adopt-existing-created-at`. The command validates the existing column and records the baseline without changing timestamps; it is not a general migration-repair switch.

```sh
npm run analyzer -- manual user list
npm run analyzer -- manual user passwd lzz
```

Usernames contain 2–32 lowercase letters, digits, `_`, or `-`. Passwords are nonempty and at most 1024 UTF-8 bytes; only salted PBKDF2-SHA256 hashes are stored. CLI password input is hidden; automation can inject `MANUAL_USER_PASSWORD` privately, never as a command argument. Account listings expose only username and creation time.

### Start and use

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
npm run analyzer -- manual import /path/to/timesheet.PROTOTYPE-WIPE-ME.json --user lzz
# → {"projects":{"inserted":N,"skipped":0},"tasks":{...},"entries":{...}}; re-running skips everything
```

Backup/reset for this domain are the signed-in account's in-app export and double-confirmed 清空 button in the ⚙ panel. Reset deletes only that user's manual entries, tasks and projects; `data backup`/`data delete` still manage only the local AI-event store. Request payloads cannot choose an owner; API reads, writes, imports and exports use the authenticated account. Foreign record ids and links return 404.

Login sessions last 30 days in a signed HttpOnly, SameSite=Lax cookie (Secure in production). The rail shows the current username and logout. Logout clears the browser cookie; login/logout replace the full page to discard the previous account's cached data. Invalid/expired cookies return 401 and page loaders redirect to login. Password changes affect future logins but do not revoke already-issued sessions; rotating `SESSION_SECRET` invalidates all signed sessions.

## Saved monthly reports

The authenticated **报告** page displays privacy-filtered AI and Git reports from independent Neon tables. Verified Active/Run, non-verified Commit Cadence Estimates, and human-declared timesheets remain separate; generating or importing a report never adds manual entries.

After the account migration above, apply the report schema once:

```sh
npm run analyzer -- manual migrate --phase reports
```

To enable one-click generation from either the local or deployed Web, run a trusted Node host connected to the same Neon database, configure `CODEX_WORKTIME_DATA_DIR` to the existing application-data directory and `CODEX_WORKTIME_LOCAL_USER` to the account you log in with. Registered Project Profiles are read from `<data-directory>/profiles/<profile-id>.json`; the filename must match the Profile's `id`. Existing local registrations can be reused. `CODEX_WORKTIME_HISTORY_HOME` optionally selects the host's history home. Only the configured account can use the host's registered Profiles; HTTP requests never supply filesystem paths.

For example, on a trusted macOS Node host with an existing `lzz` account:

```sh
export CODEX_WORKTIME_DATA_DIR="$HOME/Library/Application Support/codex-worktime"
export CODEX_WORKTIME_LOCAL_USER=lzz
npm run serve
```

Use the same Node major version for dependency installation and the Node server: `better-sqlite3` is a native addon. Verification uses Node 24; after changing Node versions, reinstall or rebuild the native dependency before collecting reports.

In **报告**, explicitly associate an existing manual project with a registered Profile ID, select a month, and click **生成报告**. This works in the deployed Web as well as localhost: the trusted host automatically receives the request, collects evidence, saves the complete snapshot to Neon, and the page opens the saved report. Routine use requires neither a CLI report-generation command nor JSON import, and the localhost page does not need to be open.

Keep the authorized computer and Node host online during generation. The hosted page shows its Collection Connection and disables generation when no authorized collector is available; **刷新报告与连接** reloads availability. Previously saved reports remain readable while the collector is offline. Generation returns a tracked run; success means the complete snapshot and every calendar day have been committed. Failed or interrupted runs preserve the previous successful report and allow retry.

If the host sleeps or loses its database connection long enough for its 60-second lease to expire, restart the local Node host to establish a fresh incarnation before generating again. Expired incarnations are deliberately not revived, so late results cannot turn interrupted runs into success.

Cloudflare Workers still do not read your computer's Git repositories, histories or SQLite. A Node host registers only its owner's safe Profile identifiers and display names, keeps a database-clock availability lease, and claims its own queued Report Runs through outbound Neon connections. It needs no public inbound port or browser-to-localhost request. Atomic claiming, incarnation fencing and lease-expiry recovery prevent two hosts from completing the same run or a retired host from publishing a late result. No raw local evidence or roots enter the registry.

The collapsed **手动导入 JSON（备份迁移,可选）** remains an alternative for transferring a previously exported snapshot, not a required generation step:

```sh
npm run analyzer -- report-month \
  --profile-id my-project --month 2026-08 \
  --data-dir /absolute/path/to/application-data \
  --output /absolute/path/to/report.html \
  --json-output /absolute/path/to/report.json
```

Cloudflare builds contain no local collector, Git scanner or native SQLite dependency. Their report page can request generation from an online authorized collector, query saved versions, and download HTML/JSON; it does not tell users to execute CLI commands and import files as the normal workflow. Configure `DATABASE_URL` and `SESSION_SECRET` and apply the report migrations (including the collector registry) before deployment.

Snapshots use strict schema v2, integer milliseconds, full Shanghai calendar months, canonical content digests and fixed pricing. Repeated equivalent inputs reuse the same immutable version; changed evidence or pricing creates a new version. Current means latest successful save, with stable ID ordering for ties. Version selections survive refresh; completing generation does not override an explicit pending selection. Hours/person-days round for display only; final cost rounds from precise duration to cents. Missing evidence remains unavailable rather than zero.

Both downloads use the selected saved snapshot without reading local sources. JSON can be reimported without duplicating reports; HTML works offline. Raw histories, bodies, session identities, roots and recognizable credentials—including quoted credential assignments—are excluded. Review exports before external sharing: defensive text filtering cannot establish that arbitrary prose is public. Manual reset/import/export and local AI deletion do not delete saved reports; this release provides no report editing, deletion, XLSX or PDF export.


## Deploy (Cloudflare Workers)

```sh
cd web
DEPLOY_TARGET=cloudflare npx vite build
CLOUDFLARE_API_TOKEN=... npx wrangler deploy   # DATABASE_URL 已在 worker secret
```

Live: https://gongshi-suji.lynzz168.workers.dev
Workers require `DATABASE_URL` and `SESSION_SECRET` secrets. Create users and migrate the database through the Node CLI before deploying this version; the Worker exposes no account-administration endpoint. Cloudflare Access can be an additional edge policy on a custom domain, not a replacement for per-user ownership.

For the legacy cutover, disable both the Worker’s `workers.dev` route and Preview URLs before migration, then deploy the account-aware version with a fresh `SESSION_SECRET` and remove the legacy `ACCESS_PASSWORD` secret. The checked-in configuration keeps Preview URLs disabled so old versions cannot expose the pre-ownership application; only the current authenticated production route is published. A migration backup remains private and separate from live traffic.
