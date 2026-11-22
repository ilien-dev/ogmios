import { describe, expect, test } from "bun:test";
import type { Chapter } from "@shared/domain";
import { FOUND, searchChapters } from "./chapterSearch";

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
