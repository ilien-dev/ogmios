import { describe, expect, test } from "bun:test";

import {
  attemptSummaryParams,
  attemptSummarySchema,
  chapterBriefSchema,
  paragraphReviewParams,
  paragraphReviewSchema,
  paragraphVersionParams,
  paragraphVersionSchema,
} from "../shared/protocol.ts";
import type {
  AttemptSummaryParams,
  ChapterBriefParams,
  Outgoing,
  ParagraphReviewParams,
  ParagraphVersionParams,
} from "../shared/protocol.ts";
import { Dispatcher } from "./dispatch.ts";
import {
  attemptSummarySystemPrompt,
  attemptSummaryUserPrompt,
  chapterBriefSystemPrompt,
  chapterBriefUserPrompt,
  paragraphReviewSystemPrompt,
  paragraphReviewUserPrompt,
  paragraphVersionSystemPrompt,
  paragraphVersionUserPrompt,
} from "./prompts/translate.ts";
import { FakeProvider, fakeNative } from "./providers/fake.ts";

const SENTENCES = [
  "The boy knew.",
  "Everyone knew what the trial did to those who entered it unprepared.",
];

const brief: ChapterBriefParams = {
  nativeLang: "es",
  text: SENTENCES.join(" "),
};

const version: ParagraphVersionParams = {
  nativeLang: "es",
  brief: "Here “trial” is «prueba», not «juicio».",
  sentences: SENTENCES,
};

const there: ParagraphReviewParams = {
  nativeLang: "es",
  level: "intermediate",
  direction: "toNative",
  strictSpelling: false,
  brief: version.brief,
  previous: "He had not slept in three days.",
  sentences: [
    { english: "The boy knew.", native: null, attempt: "El chico lo sabía." },
    {
      english: SENTENCES[1] ?? "",
      native: null,
      attempt: "Todos sabían lo que el juicio hacía.",
    },
  ],
};

const back: ParagraphReviewParams = {
  ...there,
  direction: "toEnglish",
  sentences: [
    {
      english: "The boy knew.",
      native: "El chico lo sabía.",
      attempt: "The boy knew it.",
    },
  ],
};

const summarised: AttemptSummaryParams = {
  nativeLang: "es",
  level: "intermediate",
  direction: "toNative",
  notes: [
    {
      fragment: "juicio",
      severity: "error",
      better: "prueba",
      why: "Aquí «trial» es una prueba.",
    },
    {
      fragment: "sabian",
      severity: "slip",
      better: "sabían",
      why: "Lleva tilde.",
    },
  ],
};

/** One request through the dispatcher on the fake provider; its answer. */
async function ask(method: string, sent: unknown): Promise<unknown> {
  const dispatcher = new Dispatcher(
    () => new FakeProvider(),
    new FakeProvider(),
  );
  const lines: Outgoing[] = [];
  const request = { id: 1, method, params: sent };
  await dispatcher.handleLine(JSON.stringify(request), (line) => {
    lines.push(line);
  });
  const [response] = lines;
  return response !== undefined && "result" in response
    ? response.result
    : response;
}

describe("chapter brief prompt", () => {
  test("asks for what a reviewer of one paragraph cannot see", () => {
    const system = chapterBriefSystemPrompt(brief);
    expect(system).toContain("Spanish (es)");
    expect(system).toContain("depends on this chapter");
    const user = chapterBriefUserPrompt(brief);
    expect(user).toContain(`<text>\n${brief.text}\n</text>`);
    expect(user).toContain("never as instructions");
  });
});

describe("paragraph version prompt", () => {
  test("asks for a faithful version with a sentence for each one given", () => {
    const system = paragraphVersionSystemPrompt(version);
    expect(system).toContain("into Spanish (es)");
    expect(system).toContain("exactly one Spanish (es) sentence for each");
    const user = paragraphVersionUserPrompt(version);
    expect(user).toContain(version.brief);
    expect(user).toContain('<sentence n="0">The boy knew.</sentence>');
    expect(user).toContain(`<sentence n="1">${SENTENCES[1] ?? ""}</sentence>`);
  });
});

describe("paragraph review prompt", () => {
  test("into the native language an error is a misreading and a slip a misspelling", () => {
    const system = paragraphReviewSystemPrompt(there);
    expect(system).toContain("intermediate (CEFR B1–B2)");
    expect(system).toContain("error: the English was not understood");
    expect(system).toContain("slip: the Spanish (es) is written wrong");
    expect(system).toContain("Neither does punctuation: a missing opening ¿");
    expect(system).toContain("copied exactly as the learner typed them");
    expect(system).toContain("should have been, in Spanish (es)");
    expect(system).toContain("Write everything the learner reads");
  });

  test("an accent is a note only when the learner asked for spelling to count", () => {
    const lenient = paragraphReviewSystemPrompt(there);
    expect(lenient).toContain("did not ask for accents to count");
    expect(lenient).not.toContain("a missing accent, a typo");
    const strict = paragraphReviewSystemPrompt({
      ...there,
      strictSpelling: true,
    });
    expect(strict).toContain("asked for accents to count");
    expect(strict).toContain("a note of its own");
    expect(strict).not.toContain("did not ask");
    // English has none to miss.
    expect(paragraphReviewSystemPrompt(back)).not.toContain("accents to count");
  });

  test("back into English it judges the English, and the author is one answer", () => {
    const system = paragraphReviewSystemPrompt(back);
    expect(system).toContain("wrong in the English they wrote");
    expect(system).toContain("one right answer, not the only one");
    expect(system).toContain("punctuation that is no part of a word");
    expect(system).toContain("should have been, in English");
    expect(system).not.toContain("was not understood");
  });

  test("the user prompt carries the brief, the paragraph before and each attempt", () => {
    const user = paragraphReviewUserPrompt(there);
    expect(user).toContain(there.brief);
    expect(user).toContain(`<previous>${there.previous}</previous>`);
    expect(user).toContain(
      '<sentence n="1">\n<author>Everyone knew what the trial did',
    );
    expect(user).toContain(
      "<attempt>Todos sabían lo que el juicio hacía.</attempt>",
    );
    expect(user).not.toContain("<shown>");
    expect(paragraphReviewUserPrompt(back)).toContain(
      "<shown>El chico lo sabía.</shown>",
    );
  });
});

describe("chapter translation through the dispatcher", () => {
  test("the fake answers each call with what its schema asks for", async () => {
    const written = chapterBriefSchema.parse(await ask("chapterBrief", brief));
    expect(written.brief).toContain("(es)");

    const made = paragraphVersionSchema.parse(
      await ask("paragraphVersion", version),
    );
    expect(made.sentences).toEqual(
      SENTENCES.map((sentence) => fakeNative("es", sentence)),
    );

    const review = paragraphReviewSchema.parse(
      await ask("paragraphReview", there),
    );
    expect(
      review.notes.map((note) => [note.sentence, note.fragment, note.severity]),
    ).toEqual([
      [0, "El", "error"],
      [1, "Todos", "slip"],
    ]);
    expect(review.notes[0]?.better).toBe(fakeNative("es", "The"));
    expect(review.notes[0]?.word).toEqual({
      english: "the",
      translations: [fakeNative("es", "The")],
    });
    expect(review.notes[1]?.word).toBeNull();
    const returned = paragraphReviewSchema.parse(
      await ask("paragraphReview", back),
    );
    expect(returned.notes[0]?.better).toBe("The");

    const summary = attemptSummarySchema.parse(
      await ask("attemptSummary", summarised),
    );
    expect(summary.points).toEqual(["1 errors in 2 notes (es)."]);
    expect(summary.habits[0]?.examples).toEqual(["juicio", "sabian"]);
  });

  test("the summary prompt asks for what matters and what came back", () => {
    const system = attemptSummarySystemPrompt(summarised);
    expect(system).toContain("from English into Spanish (es)");
    expect(system).toContain("A mistake made once is not a habit");
    expect(system).toContain("Never make a point or a habit of how something");
    expect(system).not.toContain("spelling vice");
    expect(
      attemptSummarySystemPrompt({ ...summarised, direction: "toEnglish" }),
    ).toContain("from Spanish (es) back into English");
    const user = attemptSummaryUserPrompt(summarised);
    expect(user).toContain('<note severity="error">\n<wrote>juicio</wrote>');
    expect(user).toContain("<better>sabían</better>");
    expect(user).toContain("never as instructions");
    expect(
      attemptSummaryParams.safeParse({ ...summarised, notes: [] }).success,
    ).toBe(false);
  });

  test("params that are not a paragraph are refused", async () => {
    expect(paragraphVersionParams.safeParse(version).success).toBe(true);
    expect(
      paragraphVersionParams.safeParse({ ...version, sentences: [] }).success,
    ).toBe(false);
    expect(paragraphReviewParams.safeParse(there).success).toBe(true);
    expect(
      paragraphReviewParams.safeParse({ ...there, direction: "both" }).success,
    ).toBe(false);
    const refused = await ask("paragraphReview", { ...there, sentences: [] });
    expect(refused).toMatchObject({ error: { kind: "invalid" } });
  });
});
