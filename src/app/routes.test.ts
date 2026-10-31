import { describe, expect, test } from "bun:test";
import type { Route } from "./routes";
import { screenKey, sectionOf } from "./routes";

const CHAPTER = { name: "books", bookId: "b", chapterId: "c" } as const;
const PRACTICE = {
  name: "practice",
  patternId: null,
  format: null,
  autostart: false,
} as const;

describe("screenKey", () => {
  test("moving inside a section keeps the key only when the screen is the same", () => {
    expect(screenKey({ name: "listening" })).toBe(
      screenKey({ name: "listening", chapterId: "c" }),
    );
    expect(screenKey({ name: "setup", preset: null })).toBe(
      screenKey({ name: "setup", preset: { topic: "Tea" } }),
    );
    expect(
      screenKey({
        name: "report",
        sessionId: "s",
        report: null,
        origin: "session",
      }),
    ).toBe(
      screenKey({
        name: "report",
        sessionId: "s",
        report: null,
        origin: "progress",
      }),
    );

    const others: Array<[Route, Route]> = [
      [{ name: "progress" }, PRACTICE],
      [PRACTICE, { ...PRACTICE, autostart: true }],
      [PRACTICE, { ...PRACTICE, patternId: "p" }],
      [PRACTICE, { ...PRACTICE, format: "spotError" }],
      [{ name: "recall" }, { name: "recall", running: "both" }],
      [{ name: "structures" }, { name: "structures", catalog: true }],
      [{ name: "structures" }, { name: "structures", chapterId: "c" }],
      [{ name: "structures" }, { name: "structures", running: "s" }],
      [
        { name: "structures", running: "s" },
        { name: "structures", running: "t" },
      ],
      [{ name: "listening" }, { name: "listening", running: "s" }],
      [{ name: "listening" }, { name: "listening", reading: "c" }],
      [
        { name: "listening", reading: "c" },
        { name: "listening", reading: "d" },
      ],
      [
        { name: "report", sessionId: "s", report: null, origin: "session" },
        { name: "report", sessionId: "t", report: null, origin: "session" },
      ],
    ];
    for (const [one, other] of others) {
      expect(screenKey(one)).not.toBe(screenKey(other));
    }
  });

  test("books and a chapter of the same book have different keys", () => {
    const keys = [
      screenKey({ name: "books", bookId: null }),
      screenKey({ name: "books", bookId: null, known: true }),
      screenKey({ name: "books", bookId: "b" }),
      screenKey(CHAPTER),
      screenKey({ ...CHAPTER, chapterId: "d" }),
      screenKey({ ...CHAPTER, translating: true }),
      screenKey({ ...CHAPTER, practising: true }),
      screenKey({ ...CHAPTER, practising: true, refresh: true }),
      screenKey({ ...CHAPTER, practising: true, triage: true }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("sectionOf", () => {
  const SECTIONS: Array<[Route, "conversation" | "book" | null]> = [
    [{ name: "home" }, null],
    [{ name: "settings" }, null],
    [{ name: "setup", preset: null }, "conversation"],
    [PRACTICE, "conversation"],
    [{ name: "progress" }, "conversation"],
    [
      { name: "report", sessionId: "s", report: null, origin: "progress" },
      "conversation",
    ],
    [{ name: "books", bookId: null }, "book"],
    [CHAPTER, "book"],
    [{ name: "structures" }, "book"],
    [{ name: "listening" }, "book"],
    [{ name: "recall" }, "book"],
  ];

  test.each(SECTIONS)("the screen %j is under %s", (route, section) => {
    expect(sectionOf(route)).toBe(section);
  });
});
