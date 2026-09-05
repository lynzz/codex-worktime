import { describe, expect, it } from "vitest";
import {
  projectCreateSchema,
  projectPatchSchema,
  projectSchema,
} from "../src/contracts";

describe("project contracts", () => {
  it("完整对象通过校验", () => {
    expect(
      projectSchema.parse({ id: "p1", name: "EQA", archived: false }),
    ).toEqual({ id: "p1", name: "EQA", archived: false });
  });

  it("创建时拒绝空名并自动去除首尾空白", () => {
    expect(projectCreateSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(projectCreateSchema.parse({ name: "  EQA  " }).name).toBe("EQA");
  });

  it("补丁至少包含一个字段", () => {
    expect(projectPatchSchema.safeParse({}).success).toBe(false);
    expect(projectPatchSchema.safeParse({ archived: true }).success).toBe(true);
    expect(projectPatchSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
