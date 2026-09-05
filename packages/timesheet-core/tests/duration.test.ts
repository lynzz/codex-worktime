import { describe, expect, it } from "vitest";
import { formatHours, parseDurationInput } from "../src/duration";
import { monthDays, nextMonthFirst } from "../src/dates";

describe("monthDays(月历矩阵)", () => {
  it("2026-09:9/1 为周二,恰 1 个前置空格;非本月为空、顺序连续", () => {
    const grid = monthDays("2026-09-05");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("");
    expect(grid[1]).toBe("2026-09-01");
    expect(grid[30]).toBe("2026-09-30");
    expect(grid[31]).toBe("");
    const days = grid.filter(Boolean);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-09-01");
    expect(days.at(-1)).toBe("2026-09-30");
  });

  it("2026-08:8/1 为周六,5 个前置空格回退到 7/27 当周", () => {
    const grid = monthDays("2026-08-15");
    expect(grid[4]).toBe("");
    expect(grid[5]).toBe("2026-08-01");
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it("nextMonthFirst 跨年", () => {
    expect(nextMonthFirst("2026-12-15")).toBe("2027-01-01");
    expect(nextMonthFirst("2026-09-05")).toBe("2026-10-01");
  });
});

describe("parseDurationInput(时长输入文法)", () => {
  it.each([
    ["1.5", 90],
    ["2", 120],
    ["0.25", 15],
    ["90m", 90],
    ["1:30", 90],
    ["1:5", 65],
    ["1h30", 90],
    ["2h", 120],
    ["  1.5 ", 90],
    ["1.5H", 90],
  ])("%s -> %i 分钟", (input, expected) => {
    expect(parseDurationInput(input)).toBe(expected);
  });

  it.each([
    ["", null],
    [null, null],
    ["abc", NaN],
    ["1.5x", NaN],
    ["1:60", NaN],
    [":-1", NaN],
  ])("%j -> %s", (input, expected) => {
    expect(parseDurationInput(input)).toEqual(expected);
  });
});

describe("formatHours", () => {
  it("整数小时不带小数", () => {
    expect(formatHours(60)).toBe("1h");
    expect(formatHours(210)).toBe("3.5h");
    expect(formatHours(45)).toBe("0.75h");
  });
});
