import { describe, expect, test } from "bun:test";
import { formatWeek, speechDuration } from "./text";

describe("speechDuration", () => {
  test("counts seconds below a minute", () => {
    expect(speechDuration(0.915)).toEqual({ unit: "seconds", count: 55 });
    expect(speechDuration(0.02)).toEqual({ unit: "seconds", count: 1 });
  });

  test("counts whole minutes from a minute up", () => {
    expect(speechDuration(1)).toEqual({ unit: "minutes", count: 1 });
    expect(speechDuration(12.6)).toEqual({ unit: "minutes", count: 13 });
  });

  test("never shows sixty seconds", () => {
    expect(speechDuration(0.999)).toEqual({ unit: "minutes", count: 1 });
  });

  test("shows no speech as zero minutes", () => {
    expect(speechDuration(0)).toEqual({ unit: "minutes", count: 0 });
  });
});

describe("formatWeek", () => {
  test("labels an ISO week by its Monday", () => {
    // 2026-W39 runs Monday 21 September to Sunday 27 September.
    expect(formatWeek("2026-W39", "en")).toBe("Sep 21");
    expect(formatWeek("2026-W01", "en")).toBe("Dec 29");
    expect(formatWeek("2026-W53", "en")).toBe("Dec 28");
  });

  test("never throws on a label it cannot read", () => {
    expect(formatWeek("garbage", "en")).toBe("garbage");
  });
});
