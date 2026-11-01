import { describe, expect, test } from "bun:test";
import type { NativeRewrite, ReportCard } from "@shared/domain";
import { toSteps } from "./steps";

const rewrite: NativeRewrite = {
  original: "I go",
  rewrite: "I went",
  notes: [],
};
const item = { original: "It was good.", better: "It was great.", why: "w" };

function kinds(card: ReportCard): string[] {
  return toSteps([card]).map((step) => step.kind);
}

describe("toSteps", () => {
  test("the native rewrite is a step of its own, after could-have-said", () => {
    expect(
      kinds({ type: "couldHaveSaid", items: [item], nativeRewrite: rewrite }),
    ).toEqual(["couldHaveSaid", "nativeRewrite", "closing"]);
  });

  test("an empty half of the card makes no step", () => {
    expect(
      kinds({ type: "couldHaveSaid", items: [], nativeRewrite: rewrite }),
    ).toEqual(["nativeRewrite", "closing"]);
    expect(
      kinds({ type: "couldHaveSaid", items: [item], nativeRewrite: null }),
    ).toEqual(["couldHaveSaid", "closing"]);
  });

  test("keeps one focus and two small things, however many come", () => {
    const correction = (role: "focus" | "minor", n: number): ReportCard => ({
      type: "correction",
      role,
      itemId: `i${String(n)}`,
      patternId: `p${String(n)}`,
      original: "a",
      corrected: "b",
      highlight: "a",
      explanation: "e",
      hint: "h",
      selfCorrect: true,
      recurrence: null,
    });
    const steps = toSteps([
      correction("focus", 1),
      correction("focus", 2),
      correction("minor", 3),
      correction("minor", 4),
      correction("minor", 5),
    ]);
    expect(steps.map((step) => step.kind)).toEqual([
      "focus",
      "minors",
      "closing",
    ]);
    const minors = steps.find((step) => step.kind === "minors");
    expect(minors?.kind === "minors" ? minors.cards : []).toHaveLength(2);
  });
});
