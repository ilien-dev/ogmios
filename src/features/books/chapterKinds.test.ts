import { describe, expect, test } from "bun:test";
import { kindTallies } from "./chapterKinds";

describe("kindTallies", () => {
  test("puts phrasal verbs with verbs and the unlabelled with the others, in the board's order", () => {
    expect(
      kindTallies([
        { kind: null, learned: 0, total: 3 },
        { kind: "verb", learned: 2, total: 5 },
        { kind: "noun", learned: 4, total: 9 },
        { kind: "phrasalVerb", learned: 1, total: 2 },
        { kind: "other", learned: 1, total: 1 },
      ]),
    ).toEqual([
      { group: "noun", learned: 4, total: 9 },
      { group: "verb", learned: 3, total: 7 },
      { group: "other", learned: 1, total: 4 },
    ]);
  });

  test("adds up to every word it was given", () => {
    const counts = [
      { kind: "adjective" as const, learned: 1, total: 4 },
      { kind: "adverb" as const, learned: 0, total: 2 },
      { kind: "expression" as const, learned: 2, total: 2 },
    ];
    const tallies = kindTallies(counts);
    const sum = (key: "learned" | "total"): number =>
      tallies.reduce((all, each) => all + each[key], 0);
    expect([sum("learned"), sum("total")]).toEqual([3, 8]);
  });

  test("shows nothing for a chapter with no words", () => {
    expect(kindTallies([])).toEqual([]);
  });
});
