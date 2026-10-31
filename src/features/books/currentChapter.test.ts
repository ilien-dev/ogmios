import { describe, expect, test } from "bun:test";
import type { Book } from "@shared/domain";
import { currentOf } from "./currentChapter";

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
