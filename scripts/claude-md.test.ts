import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CLAUDE.md is read on every turn, so every line is paid for again each time,
 * and a bloated file gets its instructions ignored. The budget keeps the rules
 * that are there being read.
 */
const BUDGET = 1000;

/** Four characters per token: the standard, pessimistic-for-prose estimate. */
function tokensIn(text: string): number {
  return Math.ceil(text.replaceAll("\r\n", "\n").length / 4);
}

const text = readFileSync(join(import.meta.dirname, "..", "CLAUDE.md"), "utf8");

describe("CLAUDE.md", () => {
  test(`is at most ${BUDGET} tokens`, () => {
    expect(tokensIn(text)).toBeLessThanOrEqual(BUDGET);
  });

  test("does not order documents read before work starts", () => {
    expect(
      /read (?:it|this|these) first|before (?:you )?start/i.test(text),
    ).toBe(false);
  });

  test("keeps the rules no gate enforces", () => {
    const missing = [
      "never corrects", // no correction mid-conversation
      "The model labels; code decides",
      "credentials",
      "ipc.ts",
    ].filter((rule) => !text.includes(rule));

    expect(missing).toEqual([]);
  });
});
