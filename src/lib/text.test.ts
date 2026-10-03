import { describe, expect, test } from "bun:test";
import { formatWeek } from "./text";

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
