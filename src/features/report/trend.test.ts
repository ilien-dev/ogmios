import { describe, expect, test } from "bun:test";
import { trend } from "./trend";

describe("trend", () => {
  test("a fall in slips is good news", () => {
    expect(trend(3.1, 4.2, 1, false)).toEqual({
      delta: 3.1 - 4.2,
      flat: false,
      better: true,
    });
  });

  test("a rise in words is good news", () => {
    expect(trend(1040, 900, 0, true).better).toBe(true);
  });

  test("no earlier sessions, or a change below the digits shown, is flat", () => {
    expect(trend(5, null, 0, true)).toEqual({
      delta: 0,
      flat: true,
      better: null,
    });
    expect(trend(5.02, 5, 1, true).flat).toBe(true);
  });
});
