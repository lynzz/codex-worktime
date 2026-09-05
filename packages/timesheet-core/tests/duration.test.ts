import { describe, expect, it } from "vitest";
import { formatHours, parseDurationInput } from "../src/duration";

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
