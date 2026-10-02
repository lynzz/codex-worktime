import { sql } from "drizzle-orm";
import { integer, pgTable, text, date, boolean, timestamp, check, index, uniqueIndex, primaryKey, jsonb, bigint } from "drizzle-orm/pg-core";
import type { ReportSnapshot } from "@codex-worktime/report-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("users_username_format", sql`${table.username} ~ '^[a-z0-9_-]{2,32}$'`),
]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  archived: boolean("archived").notNull().default(false),
}, (table) => [index("projects_user_id_idx").on(table.userId)]);

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  // 拖动排序;null 时按标题字母序排在有位置的行之后
  position: integer("position"),
}, (table) => [index("tasks_user_id_idx").on(table.userId)]);

export const entries = pgTable("entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  date: date("date").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "restrict" }),
  // 任务标题快照:任务改名不回写(ADR-0003)
  title: text("title").notNull(),
  minutes: integer("minutes").notNull(),
  taskId: text("task_id").references(() => tasks.id, {
    onDelete: "restrict",
  }),
  category: text("category"),
  note: text("note"),
  // 录入时刻(主页时间轴展示);历史行由迁移补默认值
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("entries_user_id_date_idx").on(table.userId, table.date)]);

// Stable project ids survive manual reset/deletion: report retention is independent.
// Project existence and ownership are checked when a mapping is written.
export const reportProfiles = pgTable("report_profiles", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  profileId: text("profile_id").notNull(),
  projectId: text("project_id").notNull(),
  displayName: text("display_name").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.profileId] }),
  uniqueIndex("report_profiles_owner_project_unique").on(table.userId, table.projectId),
]);

export const reportSnapshots = pgTable("report_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  profileId: text("profile_id").notNull(),
  month: text("month").notNull(),
  displayName: text("display_name").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  source: text("source", { enum: ["import", "generated"] }).notNull(),
  schemaVersion: integer("schema_version").notNull(),
  algorithmVersion: text("algorithm_version").notNull(),
  inputDigest: text("input_digest").notNull(),
  activeMs: bigint("active_ms", { mode: "number" }),
  runMs: bigint("run_ms", { mode: "number" }),
  commitEstimateMs: bigint("commit_estimate_ms", { mode: "number" }),
  estimatedCostCents: bigint("estimated_cost_cents", { mode: "number" }),
  payload: jsonb("payload").$type<ReportSnapshot>().notNull(),
}, (table) => [
  uniqueIndex("report_snapshots_identity_unique").on(table.userId, table.profileId, table.month, table.schemaVersion, table.algorithmVersion, table.inputDigest),
  index("report_snapshots_owner_month_idx").on(table.userId, table.profileId, table.month, table.savedAt, table.id),
  check("report_snapshots_source_valid", sql`${table.source} in ('import', 'generated')`),
]);

export const reportDays = pgTable("report_days", {
  snapshotId: text("snapshot_id").notNull().references(() => reportSnapshots.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  activeMs: bigint("active_ms", { mode: "number" }),
  runMs: bigint("run_ms", { mode: "number" }),
  commitCount: integer("commit_count").notNull(),
  commitEstimateMs: bigint("commit_estimate_ms", { mode: "number" }),
  payload: jsonb("payload").$type<ReportSnapshot["days"][number]>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.date] }),
]);

export const reportRuns = pgTable("report_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  profileId: text("profile_id").notNull(),
  month: text("month").notNull(),
  instanceId: text("instance_id").notNull(),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorCode: text("error_code", { enum: ["COLLECT_FAILED", "SAVE_FAILED", "INTERRUPTED"] }),
  snapshotId: text("snapshot_id").references(() => reportSnapshots.id, { onDelete: "restrict" }),
}, (table) => [
  index("report_runs_owner_idx").on(table.userId, table.id),
  index("report_runs_instance_status_idx").on(table.instanceId, table.status),
  check("report_runs_status_valid", sql`${table.status} in ('queued', 'running', 'succeeded', 'failed')`),
  check("report_runs_error_valid", sql`${table.errorCode} is null or ${table.errorCode} in ('COLLECT_FAILED', 'SAVE_FAILED', 'INTERRUPTED')`),
  check("report_runs_result_valid", sql`(${table.status} = 'succeeded' and ${table.snapshotId} is not null and ${table.finishedAt} is not null and ${table.errorCode} is null) or (${table.status} <> 'succeeded' and ${table.snapshotId} is null)`),
]);
