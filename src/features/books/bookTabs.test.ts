import { describe, expect, test } from "bun:test";
import type { Chapter } from "@shared/domain";
import { findChapters, nextTab } from "./bookTabs";

function chapter(
  index: number,
  title: string,
  readiness: number | null,
): Chapter {
  return {
    id: `c${index}`,
    index,
    title,
    words: 1000,
    prepared: readiness === null ? null : "most",
    readiness,
  };
}

const BOOK = [
  chapter(0, "Down the Rabbit-Hole", 12),
  chapter(1, "The Pool of Tears", 100),
  chapter(2, "", null),
  chapter(11, "Alice's Evidence", null),
];
const name = (each: Chapter): string =>
  each.title === "" ? `Section ${each.index + 1}` : each.title;

describe("nextTab", () => {
  test("a chapter asks for its words until it is ready to read", () => {
    expect(nextTab(chapter(0, "", null))).toBe("words");
    expect(nextTab(chapter(0, "", 0))).toBe("words");
    expect(nextTab(chapter(0, "", 99))).toBe("words");
  });

  test("a chapter that is ready to read asks to be listened to", () => {
    expect(nextTab(chapter(0, "", 100))).toBe("listen");
  });
});

describe("findChapters", () => {
  test("nothing asked finds every chapter, in order", () => {
    expect(findChapters(BOOK, "  ", name)).toEqual(BOOK);
  });

  test("a number finds the chapter at that place, and only that one", () => {
    expect(findChapters(BOOK, "1", name).map((each) => each.id)).toEqual([
      "c0",
    ]);
    expect(findChapters(BOOK, "12", name).map((each) => each.id)).toEqual([
      "c11",
    ]);
  });

  test("words find the chapters named so, whatever their case", () => {
    expect(findChapters(BOOK, "POOL", name).map((each) => each.id)).toEqual([
      "c1",
    ]);
    expect(findChapters(BOOK, "section", name).map((each) => each.id)).toEqual([
      "c2",
    ]);
    expect(findChapters(BOOK, "zebra", name)).toEqual([]);
  });
});
