import { integer, pgTable, text, date, boolean } from "drizzle-orm/pg-core";

// 数据模型由 spec #11 / ADR-0003 固定;一次迁移建齐三张表,
// 各票只暴露各自的路由与 UI。
export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  archived: boolean("archived").notNull().default(false),
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
});

export const entries = pgTable("entries", {
  id: text("id").primaryKey(),
  date: date("date").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "restrict" }),
  // 任务标题快照:任务改名不回写(ADR-0003)
  title: text("title").notNull(),
  minutes: integer("minutes").notNull(),
  taskId: text("task_id").references(() => tasks.id, {
    onDelete: "set null",
  }),
  category: text("category"),
  note: text("note"),
});
