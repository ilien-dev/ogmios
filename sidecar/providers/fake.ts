import type {
  Analysis,
  AnalyzeParams,
  AttemptSummary,
  AttemptSummaryParams,
  ChapterBrief,
  ChapterBriefParams,
  CheckResult,
  ComposeParams,
  Composed,
  DrillGenerateParams,
  DrillSet,
  ModelsResult,
  ParagraphReview,
  ParagraphReviewParams,
  ParagraphVersion,
  ParagraphVersionParams,
  SentenceReviewParams,
  SentenceVerdicts,
  SentenceWriteParams,
  SentencesWritten,
  StructureDetectParams,
  StructureGrade,
  StructureGradeParams,
  StructuresFound,
  Vocab,
  VocabExtractParams,
  VocabJudgeParams,
  VocabLabelParams,
  VocabLabels,
  VocabVerdict,
} from "../../shared/protocol.ts";
import { AgentError } from "../errors.ts";
import { STARTERS_CLOSE, STARTERS_OPEN } from "../starters.ts";
import type {
  ChatReply,
  ChatTask,
  DeltaSink,
  Provider,
  StructuredRequest,
  StructuredTask,
} from "./provider.ts";
import { parseValue } from "./structured.ts";

/**
 * Deterministic answers for the Rust integration tests and the UI dev loop
 * (`OGMIOS_FAKE=1`). Plausible rather than clever: each one passes the same
 * schema a real answer must, and echoes ids from the request so Rust can
 * store it.
 */

function fakeAnalysis(params: AnalyzeParams): Analysis {
  const first = params.turns.find((turn) => turn.role === "user");
  const existing = params.patterns[0];
  return {
    errors:
      first === undefined
        ? []
        : [
            {
              turnId: first.id,
              original: first.sent.split(" ").slice(0, 4).join(" "),
              corrected: "I went there yesterday",
              kind: "grammarRule",
              global: false,
              ruleBased: true,
              aboveLevel: false,
              pattern: {
                existingId: existing?.id ?? null,
                newKey: existing === undefined ? "past_simple_irregular" : null,
                description: "Past simple of irregular verbs",
              },
              confidence: 0.9,
              asrSuspect: false,
            },
          ],
    correctUses: [],
    edits: [],
    couldHaveSaid: [],
    nativeRewrite: null,
    strengths: ["You kept every answer on topic."],
    bestSentenceTurnId: first?.id ?? null,
    bestSentence: first?.sent ?? null,
    complexity: { clausesPerUnit: 1.4, subordinationRatio: 0.2 },
    cefr: {
      range: "B1",
      accuracy: "B1",
      fluency: "B1",
      interaction: "B1",
      coherence: "B1",
      overall: "B1",
    },
    profileFacts: [],
    partnerVocabulary: [{ english: "to wind down", note: "to relax" }],
    challengeAchieved: params.challenge === null ? null : false,
  };
}

function fakeDrills(params: DrillGenerateParams): DrillSet {
  const target = params.patterns[0];
  if (target === undefined) {
    return { items: [] };
  }
  const count = params.blocked + params.mixed;
  const items = Array.from({ length: count }, (_, index) => {
    const pattern =
      index < params.blocked
        ? target
        : (params.patterns[index % params.patterns.length] ?? target);
    return {
      format: params.format,
      patternId: pattern.id,
      prompt: `Yesterday I (go) to the market. [${index + 1}]`,
      instruction: "Rewrite the sentence correctly.",
      options:
        params.format === "spotError"
          ? [
              "Yesterday I goed to the market.",
              "Yesterday I went to the market.",
            ]
          : [],
      answer: "Yesterday I went to the market.",
    };
  });
  return { items };
}

function fakeComposed(params: ComposeParams): Composed {
  return {
    corrections: params.corrections.map((correction) => ({
      itemId: correction.itemId,
      highlight: correction.original,
      explanation: "This verb is irregular in the past.",
      hint: "Think of the past form of the verb.",
    })),
    challenge:
      params.focus === null
        ? null
        : { text: "Use the past simple twice next time.", targetCount: 2 },
  };
}

/** The shortest word the fake lists at each depth: a deeper one lists more. */
const FAKE_MIN_LETTERS: Record<VocabExtractParams["depth"], number> = {
  hardest: 10,
  relevant: 8,
  most: 6,
};

/**
 * Every long word of the text, once, plus every number; a capitalised word
 * is called a proper noun. Rust is left the names, numbers and repeats to
 * drop, as with a real answer.
 */
function fakeVocab(params: VocabExtractParams): Vocab {
  const min = FAKE_MIN_LETTERS[params.depth];
  const seen: Set<string> = new Set();
  const items: Vocab["items"] = [];
  for (const sentence of params.text.split(/(?<=[.!?])\s+/u)) {
    for (const form of sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
      const lemma = form.toLowerCase();
      const listed = form.length >= min || /^\d+$/u.test(form);
      if (listed && !seen.has(lemma)) {
        seen.add(lemma);
        items.push({
          lemma,
          form,
          sentence: sentence.trim(),
          partOfSpeech: "noun",
          transitive: false,
          translations: [`${lemma} (${params.nativeLang})`],
          properNoun: form !== lemma,
          needsContext: false,
          verbForm: null,
        });
      }
    }
  }
  return { items };
}

/**
 * What an answer the fake upholds begins with. Nothing the code accepts
 * begins so, so a test can miss a word on purpose and still be "right".
 */
export const FAKE_UPHELD = "also ";

/** Upholds an answer that begins with {@link FAKE_UPHELD}; no other. */
function fakeVerdict(params: VocabJudgeParams): VocabVerdict {
  const correct = params.answer.trim().toLowerCase().startsWith(FAKE_UPHELD);
  const verb = correct ? "fits" : "does not fit";
  return {
    correct,
    reason: `"${params.answer}" ${verb} "${params.lemma}" (${params.nativeLang}).`,
  };
}

/**
 * Every word a verb that takes an object: not what the fake calls a word it
 * extracts. A translation in the form of the word is the translation and
 * "ó".
 */
function fakeLabels(params: VocabLabelParams): VocabLabels {
  return {
    labels: params.words.map((word) => ({
      id: word.id,
      partOfSpeech: "verb",
      transitive: true,
      verbForm: "past",
      inForm: word.translations.map((each) => `${each}ó`),
    })),
  };
}

/** What the fake calls a bad sentence when it looks at one. */
const FAKE_BAD = "clumsy";

/** A hint that is never the English word: only how long the word is. */
function fakeHint(form: string, lang: string): string {
  return `palabra de ${String(form.length)} letras (${lang})`;
}

/** Every sentence of the book glossed. */
function fakeSentences(params: SentenceWriteParams): SentencesWritten {
  const lang = params.nativeLang;
  return {
    words: params.words.map((word) => ({
      id: word.id,
      book: word.book.map((sentence, index) => {
        const hint = fakeHint(word.lemma, lang);
        // The hint is words of the translation: Rust keeps no other.
        return { index, hint, translation: `${hint}: ${sentence}` };
      }),
    })),
  };
}

function fakeSentenceReview(params: SentenceReviewParams): SentenceVerdicts {
  return {
    verdicts: params.sentences.map((each) => ({
      id: each.id,
      good: !each.sentence.includes(FAKE_BAD),
      also: [],
      hints: [],
      verbForm: null,
    })),
  };
}

function fakeBrief(params: ChapterBriefParams): ChapterBrief {
  const words = params.text.split(/\s+/u).length;
  return { brief: `A chapter of ${words} words (${params.nativeLang}).` };
}

/** What the fake puts before a sentence it "translates". */
export function fakeNative(nativeLang: string, sentence: string): string {
  return `[${nativeLang}] ${sentence}`;
}

/** A sentence for each one given, as Rust requires. */
function fakeVersion(params: ParagraphVersionParams): ParagraphVersion {
  return {
    sentences: params.sentences.map((sentence) =>
      fakeNative(params.nativeLang, sentence),
    ),
  };
}

/**
 * A note on the first word of every sentence, the first one an error about
 * a word to practise and the rest slips, which are about none: Rust is left
 * the placing and the score, as with a real answer.
 */
function fakeReview(params: ParagraphReviewParams): ParagraphReview {
  return {
    good: `Every sentence is there (${params.nativeLang}).`,
    notes: params.sentences.map((line, sentence) => {
      const [fragment = ""] = line.attempt.split(" ");
      const [english = ""] = line.english.split(" ");
      return {
        sentence,
        fragment,
        severity: sentence === 0 ? "error" : "slip",
        better:
          params.direction === "toEnglish"
            ? english
            : fakeNative(params.nativeLang, english),
        why: `"${fragment}" is not "${english}".`,
        word:
          sentence === 0
            ? {
                english: english.toLowerCase(),
                translations: [fakeNative(params.nativeLang, english)],
              }
            : null,
      };
    }),
  };
}

/** One point for each severity seen, and one habit over every note. */
function fakeSummary(params: AttemptSummaryParams): AttemptSummary {
  const errors = params.notes.filter((note) => note.severity === "error");
  return {
    points: [
      `${String(errors.length)} errors in ${String(params.notes.length)} notes (${params.nativeLang}).`,
    ],
    habits: [
      {
        habit: `The first word (${params.direction})`,
        advice: "Read the whole sentence first.",
        examples: params.notes.map((note) => note.fragment),
      },
    ],
  };
}

/**
 * A sentence of three words or more has the structure, well formed; it has
 * the word when it holds it as given, and a slip when it ends without a
 * full stop.
 */
function fakeGrade(params: StructureGradeParams): StructureGrade {
  const answer = params.answer.trim();
  const usesStructure = answer.split(/\s+/u).length >= 3;
  const word = params.word ?? "";
  return {
    usesStructure,
    wellFormed: usesStructure,
    usesWord: answer.toLowerCase().includes(word.toLowerCase()),
    slips: usesStructure && !answer.endsWith("."),
    explanation: `${params.structure.name}: ${params.structure.form} (${params.nativeLang}).`,
    better: `A sentence with ${word === "" ? "it" : word} (${params.structure.key}).`,
  };
}

/** The first structure in every sentence, the second in the first one. */
function fakeFound(params: StructureDetectParams): StructuresFound {
  const sentences = params.text.split(/(?<=[.!?])\s+/u);
  const [sentence = ""] = sentences;
  return {
    found: params.structures.slice(0, 2).map((each, at) => ({
      key: each.key,
      count: at === 0 ? sentences.length : 1,
      sentence,
    })),
  };
}

function answerFor(request: StructuredRequest): unknown {
  switch (request.method) {
    case "help":
      return {
        options: [
          { english: "I'm looking forward to it", note: null },
          { english: "I can't wait", note: "more casual" },
        ],
      };
    case "analyze":
      return fakeAnalysis(request.params);
    case "compose":
      return fakeComposed(request.params);
    case "selfCheck":
      return {
        correct:
          request.params.attempt.trim().toLowerCase() ===
          request.params.corrected.trim().toLowerCase(),
        hint: "Look at the verb.",
      };
    case "drillGenerate":
      return fakeDrills(request.params);
    case "drillGrade":
      return {
        correct:
          request.params.response.trim().toLowerCase() ===
          request.params.item.answer.trim().toLowerCase(),
        explanation: "The past of 'go' is 'went'.",
        expected: request.params.item.answer,
      };
    case "vocabExtract":
      return fakeVocab(request.params);
    case "vocabJudge":
      return fakeVerdict(request.params);
    case "vocabLabel":
      return fakeLabels(request.params);
    case "sentenceWrite":
      return fakeSentences(request.params);
    case "sentenceReview":
      return fakeSentenceReview(request.params);
    case "chapterBrief":
      return fakeBrief(request.params);
    case "paragraphVersion":
      return fakeVersion(request.params);
    case "paragraphReview":
      return fakeReview(request.params);
    case "attemptSummary":
      return fakeSummary(request.params);
    case "structureGrade":
      return fakeGrade(request.params);
    case "structureDetect":
      return fakeFound(request.params);
    default:
      return null;
  }
}

function openingFor(task: ChatTask): string {
  return `What's one thing about ${task.context.setup.topic} that happened to you recently? Tell me what happened.`;
}

export class FakeProvider implements Provider {
  check(): Promise<CheckResult> {
    return Promise.resolve({ ok: true, message: null });
  }

  models(): Promise<ModelsResult> {
    return Promise.resolve([
      {
        id: "sonnet",
        name: "Sonnet",
        description: "Fake model",
        efforts: ["low", "medium", "high"],
      },
      { id: "haiku", name: "Haiku", description: null, efforts: [] },
    ]);
  }

  chat(task: ChatTask, onDelta: DeltaSink): Promise<ChatReply> {
    const opening = task.history.length === 0;
    const reply = opening
      ? openingFor(task)
      : "Oh really? That sounds interesting. What happened next?";
    // The tail a real partner writes at basic level, for the caller to cut.
    const starters = opening
      ? "Last week I…|One day, I…"
      : "After that, I…|Then we…|In the end,…";
    const text =
      task.context.setup.level === "basic"
        ? `${reply}
${STARTERS_OPEN}${starters}${STARTERS_CLOSE}`
        : reply;
    // Two deltas, so a consumer's joining logic is exercised.
    const middle = Math.ceil(text.length / 2);
    onDelta(text.slice(0, middle));
    onDelta(text.slice(middle));
    return Promise.resolve({
      text,
      providerRef: task.providerRef ?? "fake-session",
    });
  }

  structured<T>(task: StructuredTask<T>): Promise<T> {
    const parsed = parseValue(task.schema, answerFor(task.request));
    if (!parsed.ok) {
      throw new AgentError(
        "internal",
        `fake answer is invalid: ${parsed.issues}`,
      );
    }
    return Promise.resolve(parsed.value);
  }
}
