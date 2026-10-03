import { describe, expect, test } from "bun:test";

import type { Analysis, AnalyzeParams } from "../shared/protocol.ts";
import { findSpan, sanitizeAnalysis, sanitizeComposed } from "./sanitize.ts";

describe("findSpan", () => {
  test("returns the span as the source spells it", () => {
    expect(findSpan("I goed to  Paris", "goed to Paris")).toBe(
      "goed to  Paris",
    );
    expect(findSpan("I don’t know", "i don't KNOW")).toBe("I don’t know");
    expect(findSpan("I went home", "I goes home")).toBeNull();
    expect(findSpan("anything", "  ")).toBeNull();
  });
});

const params: AnalyzeParams = {
  level: "intermediate",
  cefr: null,
  nativeLang: "es",
  goal: "work",
  variant: "us",
  turns: [
    { id: "a1", role: "assistant", said: null, sent: "How was it?" },
    {
      id: "u1",
      role: "user",
      said: null,
      sent: "It was very funny, I goed there",
    },
  ],
  patterns: [{ id: "p1", key: "past_simple", description: "Pasado" }],
  challenge: null,
};

function error(
  turnId: string,
  original: string,
  existingId: string | null,
): Analysis["errors"][number] {
  return {
    turnId,
    original,
    corrected: "went",
    kind: "grammarRule",
    global: false,
    ruleBased: true,
    aboveLevel: false,
    pattern: { existingId, newKey: null, description: "Pasado" },
    confidence: 0.9,
    asrSuspect: false,
  };
}

const base: Analysis = {
  errors: [],
  correctUses: [],
  edits: [],
  couldHaveSaid: [],
  nativeRewrite: null,
  strengths: [],
  bestSentenceTurnId: null,
  bestSentence: null,
  complexity: { clausesPerUnit: null, subordinationRatio: null },
  cefr: {
    range: "B1",
    accuracy: "B1",
    fluency: "B1",
    interaction: "B1",
    coherence: "B1",
    overall: "B1",
  },
  profileFacts: [],
  partnerVocabulary: [],
  challengeAchieved: true,
};

describe("sanitizeAnalysis", () => {
  test("drops quotes that are not in the turn and repairs near-misses", () => {
    const result = sanitizeAnalysis(
      {
        ...base,
        errors: [
          error("u1", "I Goed there", "p1"),
          error("u1", "I eated", "p1"),
          error("a1", "How was it", "p1"),
        ],
      },
      params,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.original).toBe("I goed there");
  });

  test("turns an unknown pattern id into a new key", () => {
    const result = sanitizeAnalysis(
      { ...base, errors: [error("u1", "goed", "invented_id")] },
      params,
    );
    expect(result.errors[0]?.pattern).toMatchObject({
      existingId: null,
      newKey: "invented_id",
    });
  });

  test("keeps a rewrite note only when both spans are where it says", () => {
    const note = (from: string, to: string) => ({ from, to, why: "w" });
    const result = sanitizeAnalysis(
      {
        ...base,
        nativeRewrite: {
          original: "It was very funny, I goed there",
          rewrite: "It was hilarious. I went there.",
          notes: [
            note("Very Funny", "hilarious"),
            note("I goed", "I walked"),
            note("nowhere", "I went"),
          ],
        },
      },
      params,
    );
    expect(result.nativeRewrite?.notes).toEqual([
      note("very funny", "hilarious"),
    ]);
    expect(sanitizeAnalysis(base, params).nativeRewrite).toBeNull();
  });

  test("answers the challenge only when there was one", () => {
    expect(sanitizeAnalysis(base, params).challengeAchieved).toBeNull();
  });
});

describe("sanitizeComposed", () => {
  test("falls back to the whole sentence when the highlight is not in it", () => {
    const result = sanitizeComposed(
      {
        corrections: [
          { itemId: "i1", highlight: "gone", explanation: "e", hint: "h" },
          { itemId: "unknown", highlight: "x", explanation: "e", hint: "h" },
        ],
        challenge: { text: "t", targetCount: 2 },
      },
      {
        nativeLang: "es",
        level: "basic",
        corrections: [
          {
            itemId: "i1",
            original: "I goed home",
            corrected: "I went home",
            kind: "grammarRule",
            patternDescription: "Pasado",
          },
        ],
        focus: null,
      },
    );
    expect(result.corrections).toEqual([
      { itemId: "i1", highlight: "I goed home", explanation: "e", hint: "h" },
    ]);
    expect(result.challenge).toBeNull();
  });
});
