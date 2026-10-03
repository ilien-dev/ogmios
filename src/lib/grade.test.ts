import { describe, expect, test } from "bun:test";
import { grade } from "./grade";

describe("grade", () => {
  test("right with no help is right", () => {
    expect(grade(true, false)).toBe("right");
  });

  test("right on the second chance is only partly right", () => {
    expect(grade(true, true)).toBe("partial");
  });

  test("a miss is wrong, helped or not", () => {
    expect(grade(false, false)).toBe("wrong");
    expect(grade(false, true)).toBe("wrong");
  });
});
