import { describe, expect, test } from "bun:test";
import { todayQueue, towerHeight } from "./todayQueue";

describe("todayQueue", () => {
  test("it adds up what comes back and starts with the words", () => {
    const queue = todayQueue({ words: 7, drills: 2, structures: 3 });

    expect(queue.total).toBe(12);
    expect(queue.next).toBe("words");
    expect(queue.items).toEqual([
      { kind: "words", count: 7 },
      { kind: "drills", count: 2 },
      { kind: "structures", count: 3 },
    ]);
  });

  test("it starts with the first kind that has something", () => {
    expect(todayQueue({ words: 0, drills: 2, structures: 3 }).next).toBe(
      "drills",
    );
    expect(todayQueue({ words: 0, drills: 0, structures: 1 }).next).toBe(
      "structures",
    );
  });

  test("with nothing back it has no start, and still lists every kind", () => {
    const queue = todayQueue({ words: 0, drills: 0, structures: 0 });

    expect(queue.total).toBe(0);
    expect(queue.next).toBeNull();
    expect(queue.items.map((each) => each.kind)).toEqual([
      "words",
      "drills",
      "structures",
    ]);
  });

  test("a count below zero counts as nothing", () => {
    expect(todayQueue({ words: -1, drills: 0, structures: 0 }).total).toBe(0);
  });
});

describe("towerHeight", () => {
  test("nothing lies flat, and one thing already stands", () => {
    expect(towerHeight(0)).toBeLessThan(towerHeight(1));
    expect(towerHeight(1)).toBeGreaterThan(20);
  });

  test("more stands taller, up to a ceiling", () => {
    expect(towerHeight(3)).toBeGreaterThan(towerHeight(2));
    expect(towerHeight(12)).toBe(towerHeight(400));
  });
});
