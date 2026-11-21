import { describe, expect, test } from "bun:test";
import type { Chapter } from "@shared/domain";
import { FOUND, chapterShortcuts, searchChapters } from "./chapterSearch";

function chapter(index: number, readiness: number | null = null): Chapter {
  return {
    id: `c${String(index)}`,
    index,
    title: `Part ${String(index + 1)}`,
    words: 1000,
    prepared: readiness === null ? null : "relevant",
    readiness,
  };
}

const name = (each: Chapter): string => each.title;

describe("searchChapters", () => {
  test("puts the chapter with that number first, then the titles that have it", () => {
    const chapters = Array.from({ length: 30 }, (_, at) => ({
      ...chapter(at),
      title: at === 2 ? "Wizard" : `Part ${String(at + 1)}`,
    }));
    // Chapter 3 is called "Wizard": it comes first by its number alone.
    expect(
      searchChapters(chapters, "3", name).map((each) => each.index),
    ).toEqual([2, 12, 22, 29]);
  });

  test("finds by title whatever the case", () => {
    const chapters = [chapter(0), { ...chapter(1), title: "Local Cuisine" }];
    expect(
      searchChapters(chapters, "cuisine", name).map((each) => each.id),
    ).toEqual(["c1"]);
  });

  test("stops at a few dozen, however long the book", () => {
    const chapters = Array.from({ length: 1500 }, (_, at) => chapter(at));
    expect(searchChapters(chapters, "part", name)).toHaveLength(FOUND);
  });

  test("finds nothing for nothing asked", () => {
    expect(searchChapters([chapter(0)], "  ", name)).toEqual([]);
  });
});

describe("chapterShortcuts", () => {
  test("the chapters under way with the current one first, then the ones after it", () => {
    const chapters = [
      chapter(0, 40),
      chapter(1, 100),
      chapter(2, 18),
      chapter(3),
      chapter(4),
      chapter(5),
      chapter(6),
    ];
    const { going, next } = chapterShortcuts(chapters, "c2");
    expect(going.map((each) => each.id)).toEqual(["c2", "c0"]);
    expect(next.map((each) => each.id)).toEqual(["c3", "c4", "c5"]);
  });

  test("the current chapter leads even before it is prepared", () => {
    const { going } = chapterShortcuts([chapter(0), chapter(1, 50)], "c0");
    expect(going.map((each) => each.id)).toEqual(["c0", "c1"]);
  });

  test("jumps to the first unprepared, the last ready and the end, never to where it is", () => {
    const chapters = [
      chapter(0, 100),
      chapter(1, 100),
      chapter(2, 30),
      chapter(3),
      chapter(4),
    ];
    const { jumps } = chapterShortcuts(chapters, "c2");
    expect(jumps.firstUnprepared?.id).toBe("c3");
    expect(jumps.lastReady?.id).toBe("c1");
    expect(jumps.last?.id).toBe("c4");
  });

  test("leaves out a jump that has nowhere else to go", () => {
    const chapters = [chapter(0, 20), chapter(1)];
    const { jumps, next } = chapterShortcuts(chapters, "c1");
    expect(jumps.firstUnprepared).toBeUndefined();
    expect(jumps.lastReady).toBeUndefined();
    expect(jumps.last).toBeUndefined();
    expect(next).toEqual([]);
  });

  test("a book of one chapter offers only that chapter", () => {
    const { going, next, jumps } = chapterShortcuts([chapter(0)], "c0");
    expect(going.map((each) => each.id)).toEqual(["c0"]);
    expect(next).toEqual([]);
    expect(jumps).toEqual({});
  });

  test("shows a handful under way, however many there are", () => {
    const chapters = Array.from({ length: 40 }, (_, at) => chapter(at, 50));
    expect(chapterShortcuts(chapters, "c20").going).toHaveLength(5);
  });
});
