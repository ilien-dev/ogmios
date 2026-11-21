import { describe, expect, test } from "bun:test";
import type { PatternState, PatternView } from "@shared/domain";
import {
  byLadder,
  byWork,
  focusPattern,
  meanRate,
  stepOf,
  stepsLeft,
  weekAverage,
  weekDeltas,
} from "./ladder";

function pattern(
  id: string,
  state: PatternState,
  correctRate: number | null = null,
): PatternView {
  return {
    id,
    description: id,
    kind: "grammarRule",
    state,
    correctRate,
    sessionsSeen: 1,
    nextReviewAt: null,
  };
}

describe("ladder", () => {
  test("five states stand on four steps; slipping back stands in focus", () => {
    expect(
      (
        [
          "detected",
          "focus",
          "relapse",
          "improving",
          "mastered",
        ] as PatternState[]
      ).map(stepOf),
    ).toEqual([0, 1, 1, 2, 3]);
    expect(stepsLeft("detected")).toBe(3);
    expect(stepsLeft("focus")).toBe(2);
    expect(stepsLeft("mastered")).toBe(0);
  });

  test("the focus is the first pattern in focus, else the first slipped back", () => {
    expect(
      focusPattern([pattern("a", "relapse"), pattern("b", "focus")])?.id,
    ).toBe("b");
    expect(
      focusPattern([pattern("a", "detected"), pattern("b", "relapse")])?.id,
    ).toBe("b");
    expect(focusPattern([pattern("a", "mastered")])).toBeNull();
  });

  test("the mean rate counts only patterns with data, and none is null", () => {
    expect(
      meanRate([
        pattern("a", "focus", 0.4),
        pattern("b", "detected"),
        pattern("c", "improving", 0.8),
      ]),
    ).toBeCloseTo(0.6);
    expect(meanRate([pattern("a", "detected")])).toBeNull();
  });

  test("patterns sort up the ladder, or with the active work first", () => {
    const list = [
      pattern("m", "mastered"),
      pattern("d", "detected"),
      pattern("r", "relapse"),
      pattern("f", "focus"),
      pattern("i", "improving"),
    ];
    expect(byLadder(list).map((p) => p.id)).toEqual(["d", "r", "f", "i", "m"]);
    expect(byWork(list).map((p) => p.id)).toEqual(["r", "f", "i", "d", "m"]);
  });

  test("the last weeks carry their change from the week before", () => {
    const weeks = [
      { week: "2026-W35", minutes: 10 },
      { week: "2026-W36", minutes: 18 },
      { week: "2026-W37", minutes: 24 },
      { week: "2026-W38", minutes: 20 },
      { week: "2026-W39", minutes: 42 },
    ];
    expect(weekDeltas(weeks).map((week) => week.delta)).toEqual([8, 6, -4, 22]);
    expect(weekDeltas(weeks.slice(0, 2)).map((week) => week.delta)).toEqual([
      null,
      8,
    ]);
    expect(weekAverage(weeks)).toBeCloseTo(22.8);
    expect(weekAverage([])).toBe(0);
  });
});
