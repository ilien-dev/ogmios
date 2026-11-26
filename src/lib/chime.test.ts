import { describe, expect, test } from "bun:test";
import { CHIMES, chime, prime, verdictTone } from "./chime";
import type { Tone } from "./chime";

const TONES: Tone[] = ["right", "partial", "wrong", "neutral"];

/** The pitch each tone starts on and ends on, in Hz. */
function contour(tone: Tone): [number, number] {
  const firsts = CHIMES[tone].filter((note) => note.lead);
  return [firsts[0]?.freq ?? 0, firsts.at(-1)?.freq ?? 0];
}

describe("the sound of a verdict", () => {
  test("a right answer rises, a partial one stays, a wrong one falls, a shown one is a single note", () => {
    const [rightFrom, rightTo] = contour("right");
    const [partialFrom, partialTo] = contour("partial");
    const [wrongFrom, wrongTo] = contour("wrong");
    expect(rightTo).toBeGreaterThan(rightFrom);
    expect(partialTo).toBe(partialFrom);
    expect(wrongTo).toBeLessThan(wrongFrom);
    expect(CHIMES.neutral.filter((note) => note.lead)).toHaveLength(1);
  });

  test("every tone is loud and high enough for a laptop's speakers, and short", () => {
    for (const tone of TONES) {
      for (const note of CHIMES[tone].filter((each) => each.lead)) {
        expect(note.freq).toBeGreaterThanOrEqual(400);
        expect(note.gain).toBeGreaterThanOrEqual(0.5);
      }
      const end = Math.max(...CHIMES[tone].map((note) => note.at + note.dur));
      expect(end).toBeLessThanOrEqual(0.45);
    }
  });

  test("a verdict's tone: shown when unknown, partial when understood only with its sentence", () => {
    expect(verdictTone({ correct: true, helped: false }, false)).toBe("right");
    expect(verdictTone({ correct: true, helped: true }, false)).toBe("partial");
    expect(verdictTone({ correct: false }, false)).toBe("wrong");
    expect(verdictTone({ correct: false }, true)).toBe("neutral");
    expect(
      verdictTone({ correct: true, understood: { tied: false } }, false),
    ).toBe("partial");
  });

  test("with no audio at all, nothing breaks", () => {
    expect(() => {
      prime();
      chime("right");
    }).not.toThrow();
  });
});
