import { describe, expect, test } from "bun:test";
import type { VocabEntry } from "@shared/domain";
import { MAX_FLOORS, planTowers, wordsByStrength } from "./towers";

function entry(english: string, strength: VocabEntry["strength"]): VocabEntry {
  return { english, asked: null, date: "2026-11-20", strength };
}

describe("the towers of the daily review", () => {
  test("a floor holds four words while the words are few", () => {
    const plan = planTowers({ new: 7, settling: 4, firm: 1 });
    expect(plan.per).toBe(4);
    expect(plan.floors).toEqual({ new: 2, settling: 1, firm: 1 });
  });

  test("with hundreds of words a floor holds more, and no tower outgrows the scene", () => {
    const plan = planTowers({ new: 340, settling: 120, firm: 41 });
    expect(plan.floors.new).toBe(MAX_FLOORS);
    expect(plan.per).toBe(29);
    expect(plan.floors.settling).toBe(5);
    expect(plan.floors.firm).toBe(2);
  });

  test("a strength with no words has no floor", () => {
    const plan = planTowers({ new: 0, settling: 0, firm: 0 });
    expect(plan.per).toBe(4);
    expect(plan.floors).toEqual({ new: 0, settling: 0, firm: 0 });
  });
});

describe("the words a tower names", () => {
  test("the latest of each strength, a few, each word once", () => {
    const words = wordsByStrength(
      [
        entry("waistcoat", "settling"),
        entry("peep", "firm"),
        entry("marmalade", "new"),
        entry("waistcoat", "settling"),
        entry("tumble", "new"),
        entry("a close call", null),
        entry("daisy", "new"),
        entry("shelf", "new"),
        entry("hedge", "new"),
      ],
      4,
    );
    expect(words).toEqual({
      new: ["marmalade", "tumble", "daisy", "shelf"],
      settling: ["waistcoat"],
      firm: ["peep"],
    });
  });
});
