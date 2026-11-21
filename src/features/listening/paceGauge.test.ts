import { describe, expect, test } from "bun:test";
import type { PaceStanding } from "@shared/listening";
import { heardShare } from "./paceGauge";

const standing = (over: Partial<PaceStanding>): PaceStanding => ({
  pace: "normal",
  right: 0,
  total: 0,
  sentences: 0,
  held: false,
  ...over,
});

describe("heardShare", () => {
  test("a pace never tried has no share", () => {
    expect(heardShare(standing({}))).toBeNull();
  });

  test("the words heard, out of the words said, as a whole percent rounded down", () => {
    expect(heardShare(standing({ right: 72, total: 100, sentences: 21 }))).toBe(
      72,
    );
    expect(heardShare(standing({ right: 2, total: 3, sentences: 1 }))).toBe(66);
  });

  test("sentences with no words to hear count as nothing heard", () => {
    expect(heardShare(standing({ right: 0, total: 0, sentences: 2 }))).toBe(0);
  });
});
