import { z } from "zod";

// —— 项目(Project)契约:固定枚举,增删改名/归档 ——

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  archived: z.boolean(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "项目名不能为空").max(100, "项目名过长"),
});
export type ProjectCreate = z.infer<typeof projectCreateSchema>;

export const projectPatchSchema = z
  .object({
    name: z.string().trim().min(1, "项目名不能为空").max(100).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "至少提供 name 或 archived 之一" });
export type ProjectPatch = z.infer<typeof projectPatchSchema>;

// —— 条目(Entry)契约:日期 + 项目 + 任务标题 + 时长,无起止时间(ADR-0003)——

export const CATEGORIES = ["开发", "需求", "沟通", "验收", "其他"] as const;
export type Category = (typeof CATEGORIES)[number];

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");

export const entrySchema = z.object({
  id: z.string(),
  date: dateKey,
  projectId: z.string(),
  title: z.string().min(1),
  minutes: z.number().int().positive(),
  taskId: z.string().nullable(),
  category: z.string().nullable(),
  note: z.string().nullable(),
});
export type Entry = z.infer<typeof entrySchema>;

export const entryCreateSchema = z.object({
  date: dateKey,
  projectId: z.string({ message: "项目不能为空" }).min(1, "项目不能为空"),
  title: z.string().trim().min(1, "请填写任务标题").max(200, "任务标题过长"),
  minutes: z
    .number({ message: "请填写时长" })
    .int("时长应为整分钟")
    .min(1, "时长必须大于 0")
    .max(24 * 60, "单条时长不能超过 24 小时"),
  category: z.enum(CATEGORIES).optional(),
  note: z.string().trim().max(500).optional(),
});
export type EntryCreate = z.infer<typeof entryCreateSchema>;

export const entryPatchSchema = z
  .object({
    title: z.string().trim().min(1, "请填写任务标题").max(200).optional(),
    minutes: z
      .number({ message: "请填写时长" })
      .int("时长应为整分钟")
      .min(1, "时长必须大于 0")
      .max(24 * 60, "单条时长不能超过 24 小时")
      .optional(),
    category: z.enum(CATEGORIES).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "至少提供一个字段" });
export type EntryPatch = z.infer<typeof entryPatchSchema>;

// —— 任务行(Task Row)契约:项目(固定枚举)+ 任务标题 ——

export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string().min(1),
  position: z.number().int().nullable(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskCreateSchema = z.object({
  projectId: z.string().min(1, "项目不能为空"),
  title: z.string().trim().min(1, "请填写任务标题").max(200, "任务标题过长"),
});
export type TaskCreate = z.infer<typeof taskCreateSchema>;

export const taskPatchSchema = z.object({
  title: z.string().trim().min(1, "请填写任务标题").max(200, "任务标题过长"),
});
export type TaskPatch = z.infer<typeof taskPatchSchema>;
