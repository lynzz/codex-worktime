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
