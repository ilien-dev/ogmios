import { describe, expect, test } from "bun:test";
import type { Book } from "@shared/domain";
import { chapterOn, currentOf } from "./currentChapter";

describe("currentOf", () => {
  const book: Book = {
    id: "b",
    title: "A book",
    author: null,
    opening: "",
    chapters: [
      {
        id: "c",
        index: 0,
        title: "",
        words: 10,
        prepared: null,
        readiness: null,
      },
    ],
  };

  test("finds the chapter with its book", () => {
    expect(currentOf([book], "c")?.book.id).toBe("b");
  });

  test("a chapter of a book that is gone, or none at all, is no chapter", () => {
    expect(currentOf([], "c")).toBeNull();
    expect(currentOf([book], null)).toBeNull();
  });
});

describe("chapterOn", () => {
  const chapter = (id: string, index: number): Book["chapters"][number] => ({
    id,
    index,
    title: "",
    words: 10,
    prepared: null,
    readiness: null,
  });
  const empty: Book = {
    id: "e",
    title: "Empty",
    author: null,
    opening: "",
    chapters: [],
  };
  const full: Book = {
    id: "f",
    title: "Full",
    author: null,
    opening: "",
    chapters: [chapter("one", 0), chapter("two", 1)],
  };

  test("the chapter picked is the one the learner is on", () => {
    expect(chapterOn([empty, full], "two")?.chapter.id).toBe("two");
  });

  test("with none picked, or one that is gone, it is the first there is", () => {
    expect(chapterOn([empty, full], null)?.chapter.id).toBe("one");
    expect(chapterOn([empty, full], "gone")?.chapter.id).toBe("one");
  });

  test("a shelf without chapters has no chapter to be on", () => {
    expect(chapterOn([], null)).toBeNull();
    expect(chapterOn([empty], null)).toBeNull();
  });
});
