import { describe, expect, test } from "bun:test";
import type { Translation } from "@shared/domain";
import { placeOf, placeTarget } from "./places";
import type { Place } from "./places";
import type { Route } from "./routes";
import { screenKey, showsNav } from "./routes";

const SITTING = {
  name: "books",
  bookId: "b",
  chapterId: "c",
  practising: true,
} as const;
const PRACTICE = { name: "practice", patternId: null, format: null } as const;
const ATTEMPT = { attemptId: "a" } as Translation;

describe("screenKey", () => {
  test("a tab or a preset changes nothing: the screen is the same one", () => {
    expect(screenKey({ name: "book" })).toBe(
      screenKey({ name: "book", tab: "translate" }),
    );
    expect(screenKey({ name: "progress" })).toBe(
      screenKey({ name: "progress", tab: "structures" }),
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
        origin: "past",
      }),
    );
  });

  test("every other move is to another screen", () => {
    const others: Array<[Route, Route]> = [
      [{ name: "today" }, { name: "home" }],
      [{ name: "progress" }, PRACTICE],
      [PRACTICE, { ...PRACTICE, patternId: "p" }],
      [PRACTICE, { ...PRACTICE, format: "spotError" }],
      [
        { name: "recall", running: "both" },
        { name: "recall", running: "recognition" },
      ],
      [
        { name: "structures", running: "s" },
        { name: "structures", running: "t" },
      ],
      [
        { name: "listening", running: "s" },
        { name: "listening", reading: "s" },
      ],
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

  test("the library and every sitting on a chapter have different keys", () => {
    const keys = [
      screenKey({ name: "book" }),
      screenKey({ name: "books", bookId: null }),
      screenKey(SITTING),
      screenKey({ ...SITTING, chapterId: "d" }),
      screenKey({ ...SITTING, refresh: true }),
      screenKey({ ...SITTING, triage: true }),
      screenKey({
        name: "books",
        bookId: "b",
        chapterId: "c",
        translating: ATTEMPT,
      }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("showsNav", () => {
  const BESIDE: Route[] = [
    { name: "today" },
    { name: "home" },
    { name: "book" },
    { name: "book", tab: "listen" },
    { name: "books", bookId: null },
    { name: "setup", preset: null },
    { name: "progress" },
    { name: "settings" },
    { name: "report", sessionId: "s", report: null, origin: "past" },
  ];
  const INSTEAD: Route[] = [
    { name: "conversation", setup: {} as never },
    { name: "report", sessionId: "s", report: null, origin: "session" },
    PRACTICE,
    SITTING,
    { name: "books", bookId: "b", chapterId: "c", translating: ATTEMPT },
    { name: "recall", running: "both" },
    { name: "structures", running: "s" },
    { name: "listening", running: "s" },
    { name: "listening", reading: "c" },
  ];

  test.each(BESIDE)("the screen %j sits beside the navigation", (route) => {
    expect(showsNav(route)).toBe(true);
  });

  test.each(INSTEAD)("the activity %j takes the whole window", (route) => {
    expect(showsNav(route)).toBe(false);
  });
});

describe("places", () => {
  const PLACED: Array<[Route, Place | "settings"]> = [
    [{ name: "today" }, "today"],
    [{ name: "recall", running: "both" }, "today"],
    [{ name: "book" }, "book"],
    [{ name: "books", bookId: null }, "book"],
    [SITTING, "book"],
    [{ name: "listening", reading: "c" }, "book"],
    [{ name: "home" }, "talk"],
    [{ name: "setup", preset: null }, "talk"],
    [PRACTICE, "talk"],
    [{ name: "report", sessionId: "s", report: null, origin: "past" }, "talk"],
    [{ name: "progress" }, "mine"],
    [{ name: "progress", tab: "words" }, "mine"],
    [{ name: "structures", running: "s" }, "mine"],
    [{ name: "settings" }, "settings"],
  ];

  test.each(PLACED)("the screen %j is under %s", (route, place) => {
    expect(placeOf(route)).toBe(place);
  });

  test("each place leads to a screen of its own", () => {
    for (const place of ["today", "book", "talk", "mine"] as const) {
      expect(placeOf(placeTarget(place))).toBe(place);
    }
  });
});
