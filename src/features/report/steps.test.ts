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
});
