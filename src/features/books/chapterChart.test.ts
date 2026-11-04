import { describe, expect, test } from "bun:test";
import type { Chapter } from "@shared/domain";
import { barState, chapterWindow, wordDots } from "./chapterChart";

function chapters(count: number): Chapter[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    index,
    title: "",
    words: 1000 + index,
    prepared: null,
    readiness: null,
  }));
}

describe("chapterWindow", () => {
  test("a short book shows every chapter", () => {
    expect(chapterWindow(chapters(5), "c2", 12).map((c) => c.id)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
  });

  test("a long book shows the chapters around the current one", () => {
    const shown = chapterWindow(chapters(1492), "c700", 12);
    expect(shown).toHaveLength(12);
    expect(shown.map((c) => c.id)).toContain("c700");
    expect(shown[0]?.id).toBe("c695");
  });

  test("the window stops at both ends of the book", () => {
    expect(chapterWindow(chapters(40), "c1", 12)[0]?.id).toBe("c0");
    const end = chapterWindow(chapters(40), "c39", 12);
    expect(end[0]?.id).toBe("c28");
    expect(end.at(-1)?.id).toBe("c39");
  });

  test("with no current chapter it starts at the beginning", () => {
    expect(chapterWindow(chapters(40), null, 12)[0]?.id).toBe("c0");
  });
});

describe("barState", () => {
  test("tells an unprepared chapter apart from one with nothing learned", () => {
    const [chapter] = chapters(1);
    if (chapter === undefined) throw new Error("no chapter");
    expect(barState({ ...chapter, readiness: null })).toBe("unprepared");
    expect(barState({ ...chapter, readiness: 0 })).toBe("learning");
    expect(barState({ ...chapter, readiness: 40 })).toBe("learning");
    expect(barState({ ...chapter, readiness: 100 })).toBe("ready");
  });
});

describe("wordDots", () => {
  test("one dot a word while they fit", () => {
    expect(wordDots(12, 30, 60)).toEqual({ unit: 1, learned: 12, known: 30 });
  });

  test("past the limit each dot stands for more words, rounded up", () => {
    const dots = wordDots(155, 429, 60);
    expect(dots.unit).toBe(10);
    expect(dots.learned).toBe(16);
    expect(dots.known).toBe(43);
    expect(dots.learned + dots.known).toBeLessThanOrEqual(60);
  });

  test("a single word still shows, and none shows nothing", () => {
    expect(wordDots(1, 5000, 60).learned).toBe(1);
    expect(wordDots(0, 0, 60)).toEqual({ unit: 1, learned: 0, known: 0 });
  });
});
