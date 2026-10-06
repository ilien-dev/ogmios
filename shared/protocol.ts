/**
 * The sidecar protocol: Rust ⇄ `ogmios-agent`, one JSON object per line on
 * stdio.
 *
 *   request   {"id":1,"method":"chat","params":{…}}
 *   event     {"id":1,"event":"delta","text":"Hel"}
 *   response  {"id":1,"result":{…}}  |  {"id":1,"error":{"kind":"provider","message":"…"}}
 *
 * The sidecar owns no data. Rust sends everything a call needs and stores what
 * comes back. `src-tauri/src/agent/protocol.rs` mirrors this file; the zod
 * schemas here validate every model output before it leaves the sidecar.
 */
import { z } from "zod";

import type { ModelOption } from "./domain.ts";

// ── Shared vocabulary ─────────────────────────────────────────────────────

export const levelSchema = z.enum(["basic", "intermediate", "advanced"]);
export const cefrSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
export const providerModeSchema = z.enum(["apiKey", "claudeCode"]);
export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export const errorKindSchema = z.enum([
  "grammarRule",
  "lexical",
  "collocation",
  "wordOrder",
  "register",
  "pronoun",
  "other",
]);
export const drillFormatSchema = z.enum([
  "sameStructure",
  "transformation",
  "guidedChat",
  "spotError",
]);

// ── Envelope ──────────────────────────────────────────────────────────────

export const requestSchema = z.object({
  id: z.number().int(),
  method: z.string(),
  params: z.unknown(),
});
export type Request = z.infer<typeof requestSchema>;

export type AgentErrorKind = "provider" | "invalid" | "internal";

export type Outgoing =
  | { id: number; event: "delta"; text: string }
  | { id: number; result: unknown }
  | { id: number; error: { kind: AgentErrorKind; message: string } };

// ── configure / check / models ────────────────────────────────────────────

export const configureParams = z.object({
  mode: providerModeSchema,
  model: z.string().min(1),
  /** Null keeps the per-call defaults in `sidecar/providers/models.ts`. */
  effort: effortSchema.nullable(),
  apiKey: z.string().nullable(),
  claudePath: z.string().nullable(),
});
export type ConfigureParams = z.infer<typeof configureParams>;
/**
 * `configure` answers once the provider is in place, with the fingerprint of
 * this file as the sidecar was built from it (`sidecar/fingerprint.ts`).
 */
export interface ConfigureResult {
  protocol: number;
}

export interface CheckResult {
  ok: boolean;
  message: string | null;
}

/** `models` takes no params and lists what the configured provider offers. */
export type ModelsResult = ModelOption[];

// ── chat ──────────────────────────────────────────────────────────────────

const historyTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});

export const chatContextSchema = z.object({
  setup: z.object({
    topic: z.string(),
    level: levelSchema,
    mode: z.enum([
      "casual",
      "interview",
      "debate",
      "story",
      "roleplay",
      "material",
    ]),
    personality: z.enum([
      "curiousFriend",
      "strictInterviewer",
      "coworker",
      "contrarian",
    ]),
    focusMode: z.enum(["free", "pending"]),
    targetMinutes: z.number().nullable(),
    material: z.string().nullable(),
    continuePrevious: z.boolean(),
  }),
  learner: z.object({
    name: z.string().nullable(),
    nativeLang: z.string(),
    goal: z.enum(["work", "travel", "exams", "social", "other"]),
    variant: z.enum(["us", "uk"]),
    interests: z.array(z.string()),
    facts: z.array(z.string()),
    cefr: cefrSchema.nullable(),
  }),
  /** Structures to make essential to the task, without naming them. */
  targets: z.array(z.object({ description: z.string(), contexts: z.string() })),
  challenge: z.string().nullable(),
  /** How the partner opened the sessions before this one, newest first. */
  recentOpenings: z.array(z.string()),
  /** Phrases from recorded speech for the partner to use; often empty. */
  phrases: z.array(z.string()),
  /** Words the learner has learned, for the partner to use where they fit. */
  words: z.array(z.string()),
  /** The conversation this one continues: its topic and last turns. */
  previous: z
    .object({ topic: z.string(), turns: z.array(historyTurnSchema) })
    .nullable(),
});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const chatParams = z.object({
  context: chatContextSchema,
  /**
   * Every turn so far, oldest first, ending with the learner's new turn.
   * Empty for the opening question.
   */
  history: z
    .array(historyTurnSchema)
    .refine((turns) => turns.length === 0 || turns.at(-1)?.role === "user", {
      message: "history must end with the learner's turn",
    }),
  /** Claude Code session id from the previous turn, when the mode keeps one. */
  providerRef: z.string().nullable(),
});
export type ChatParams = z.infer<typeof chatParams>;

export interface ChatResult {
  text: string;
  /**
   * Openers for the learner's answer to this turn, written by the partner at
   * basic level; empty when it wrote none. Rust decides what is shown.
   */
  starters: string[];
  providerRef: string | null;
}

// ── help ──────────────────────────────────────────────────────────────────

export const helpParams = z.object({
  nativeLang: z.string(),
  text: z.string().min(1),
  /** The last partner turn, so the translation fits the conversation. */
  recent: z.string(),
  variant: z.enum(["us", "uk"]),
});
export type HelpParams = z.infer<typeof helpParams>;

export const helpResultSchema = z.object({
  options: z
    .array(z.object({ english: z.string(), note: z.string().nullable() }))
    .min(1)
    .max(3),
});
export type HelpResult = z.infer<typeof helpResultSchema>;

// ── analyze ───────────────────────────────────────────────────────────────

export const analyzeParams = z.object({
  level: levelSchema,
  cefr: cefrSchema.nullable(),
  nativeLang: z.string(),
  goal: z.enum(["work", "travel", "exams", "social", "other"]),
  variant: z.enum(["us", "uk"]),
  turns: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      /** Speech-recogniser output before edits; null for typed turns. */
      said: z.string().nullable(),
      sent: z.string(),
    }),
  ),
  patterns: z.array(
    z.object({ id: z.string(), key: z.string(), description: z.string() }),
  ),
  challenge: z.object({ patternId: z.string(), text: z.string() }).nullable(),
});
export type AnalyzeParams = z.infer<typeof analyzeParams>;

const errorPatternSchema = z.object({
  existingId: z.string().nullable(),
  newKey: z.string().nullable(),
  /** Short, in the learner's native language. */
  description: z.string(),
});

const analysisErrorSchema = z.object({
  turnId: z.string(),
  /** Exact fragment from the learner's turn. */
  original: z.string(),
  corrected: z.string(),
  kind: errorKindSchema,
  /** Impedes understanding. */
  global: z.boolean(),
  ruleBased: z.boolean(),
  /** Well beyond the learner's current level. */
  aboveLevel: z.boolean(),
  pattern: errorPatternSchema,
  confidence: z.number().min(0).max(1),
  asrSuspect: z.boolean(),
});

/** One change in the native rewrite: exact spans of each side. */
const rewriteNoteSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** In the learner's native language. */
  why: z.string(),
});

export const analysisSchema = z.object({
  errors: z.array(analysisErrorSchema),
  correctUses: z.array(z.object({ turnId: z.string(), patternId: z.string() })),
  edits: z.array(
    z.object({
      turnId: z.string(),
      type: z.enum(["asrFix", "selfCorrection"]),
      before: z.string(),
      after: z.string(),
      patternId: z.string().nullable(),
    }),
  ),
  couldHaveSaid: z.array(
    z.object({
      turnId: z.string(),
      original: z.string(),
      better: z.string(),
      /** In the learner's native language. */
      why: z.string(),
    }),
  ),
  nativeRewrite: z
    .object({
      original: z.string(),
      rewrite: z.string(),
      notes: z.array(rewriteNoteSchema),
    })
    .nullable(),
  /** In the learner's native language, each with concrete evidence. */
  strengths: z.array(z.string()),
  bestSentenceTurnId: z.string().nullable(),
  bestSentence: z.string().nullable(),
  complexity: z.object({
    clausesPerUnit: z.number().nullable(),
    subordinationRatio: z.number().nullable(),
  }),
  cefr: z.object({
    range: cefrSchema,
    accuracy: cefrSchema,
    fluency: cefrSchema,
    interaction: cefrSchema,
    coherence: cefrSchema,
    overall: cefrSchema,
  }),
  profileFacts: z.array(z.string()),
  /** Useful words the partner used, for the vocabulary card. */
  partnerVocabulary: z.array(
    z.object({ english: z.string(), note: z.string().nullable() }),
  ),
  challengeAchieved: z.boolean().nullable(),
});
export type Analysis = z.infer<typeof analysisSchema>;

// ── compose ───────────────────────────────────────────────────────────────

export const composeParams = z.object({
  nativeLang: z.string(),
  level: levelSchema,
  corrections: z.array(
    z.object({
      itemId: z.string(),
      original: z.string(),
      corrected: z.string(),
      kind: errorKindSchema,
      patternDescription: z.string(),
    }),
  ),
  /** The focus pattern, for which a next-session challenge is written. */
  focus: z.object({ description: z.string(), example: z.string() }).nullable(),
});
export type ComposeParams = z.infer<typeof composeParams>;

export const composedSchema = z.object({
  corrections: z.array(
    z.object({
      itemId: z.string(),
      /** The span of `original` holding the error, copied exactly. */
      highlight: z.string(),
      /** One or two lines, native language. */
      explanation: z.string(),
      /** A nudge that does not give the answer away, native language. */
      hint: z.string(),
    }),
  ),
  challenge: z
    .object({ text: z.string(), targetCount: z.number().int().min(1).max(3) })
    .nullable(),
});
export type Composed = z.infer<typeof composedSchema>;

// ── self-check ────────────────────────────────────────────────────────────

export const selfCheckParams = z.object({
  nativeLang: z.string(),
  original: z.string(),
  corrected: z.string(),
  attempt: z.string(),
});
export type SelfCheckParams = z.infer<typeof selfCheckParams>;

export const selfCheckSchema = z.object({
  correct: z.boolean(),
  hint: z.string().nullable(),
});
export type SelfCheckResult = z.infer<typeof selfCheckSchema>;

// ── drills ────────────────────────────────────────────────────────────────

const drillExampleSchema = z.object({
  original: z.string(),
  corrected: z.string(),
});

const drillPatternSchema = z.object({
  id: z.string(),
  description: z.string(),
  examples: z.array(drillExampleSchema),
});

export const drillGenerateParams = z.object({
  nativeLang: z.string(),
  level: levelSchema,
  format: drillFormatSchema,
  /** First pattern is the target; the rest are for interleaving. */
  patterns: z.array(drillPatternSchema).min(1),
  /** Items on the target pattern, then `mixed` more across all patterns. */
  blocked: z.number().int().min(0),
  mixed: z.number().int().min(0),
});
export type DrillGenerateParams = z.infer<typeof drillGenerateParams>;

export const drillItemSchema = z.object({
  format: drillFormatSchema,
  patternId: z.string(),
  prompt: z.string(),
  instruction: z.string(),
  options: z.array(z.string()),
  /** A model answer, never shown before grading. */
  answer: z.string(),
});
export type GeneratedDrillItem = z.infer<typeof drillItemSchema>;

export const drillSetSchema = z.object({ items: z.array(drillItemSchema) });
export type DrillSet = z.infer<typeof drillSetSchema>;

export const drillGradeParams = z.object({
  nativeLang: z.string(),
  item: drillItemSchema,
  response: z.string(),
});
export type DrillGradeParams = z.infer<typeof drillGradeParams>;

export const drillGradeSchema = z.object({
  correct: z.boolean(),
  explanation: z.string(),
  expected: z.string(),
});
export type DrillGrade = z.infer<typeof drillGradeSchema>;

// ── book vocabulary ───────────────────────────────────────────────────────

/** How much of a chapter's vocabulary the learner asked for. */
export const depthSchema = z.enum(["most", "relevant", "hardest"]);

export const vocabExtractParams = z.object({
  nativeLang: z.string(),
  level: levelSchema,
  depth: depthSchema,
  /** One piece of a chapter, as plain English text. */
  text: z.string().min(1),
});
export type VocabExtractParams = z.infer<typeof vocabExtractParams>;

/** What kind of word an item is, in the sense its sentence gives it. */
export const partOfSpeechSchema = z.enum([
  "noun",
  "verb",
  "phrasalVerb",
  "adjective",
  "adverb",
  "expression",
  "other",
]);

/** The form a verb has in the sentence it is asked with. */
export const verbFormSchema = z.enum([
  "base",
  "present",
  "past",
  "pastParticiple",
  "ing",
]);

export const vocabItemSchema = z.object({
  /** Base form: "run" for "ran". A phrasal verb or an idiom is one item. */
  lemma: z.string().min(1),
  /** The form as it appears in the text. */
  form: z.string().min(1),
  /** The sentence it appears in, copied from the text. */
  sentence: z.string(),
  /** What kind of word it is in that sentence. */
  partOfSpeech: partOfSpeechSchema,
  /** A verb or a phrasal verb that takes an object in that sentence. */
  transitive: z.boolean(),
  /** Accepted translations for that sense, in the learner's language. */
  translations: z.array(z.string().min(1)).min(1),
  /** A name of a person, place or brand. Rust drops these. */
  properNoun: z.boolean(),
  /** The word cannot be translated well without its sentence. */
  needsContext: z.boolean(),
  /** The form a verb has in that sentence; null for any other word. */
  verbForm: verbFormSchema.nullable(),
});
export type VocabItem = z.infer<typeof vocabItemSchema>;

export const vocabSchema = z.object({ items: z.array(vocabItemSchema) });
export type Vocab = z.infer<typeof vocabSchema>;

/** Which way a word was asked: English → native, or native → English. */
export const directionSchema = z.enum(["recognition", "production"]);

/** "I was right": a missed answer the learner stands by. */
export const vocabJudgeParams = z.object({
  nativeLang: z.string(),
  direction: directionSchema,
  /**
   * The English word as the learner was asked it: its base form, or, asked
   * English → native with a sentence of its bank, the form that sentence has
   * it in.
   */
  lemma: z.string().min(1),
  /** The sentence of the book the word was taken from. */
  sentence: z.string(),
  /** The translations accepted so far, in the learner's language. */
  translations: z.array(z.string()),
  /** What the learner typed, as they typed it. */
  answer: z.string().min(1),
  /** The learner asked for accents and spelling to count. */
  strictSpelling: z.boolean(),
  /**
   * What fills the blank the answer was typed into, for a word asked native →
   * English with a sentence of its bank: only that exact form is right.
   */
  blank: z.string().nullable(),
});
export type VocabJudgeParams = z.infer<typeof vocabJudgeParams>;

export const vocabVerdictSchema = z.object({
  /** The answer is a right translation for the sense of the sentence. */
  correct: z.boolean(),
  /** One line in the learner's language saying why. */
  reason: z.string().min(1),
});
export type VocabVerdict = z.infer<typeof vocabVerdictSchema>;

/** Words stored before words were labelled, to be said what kind each is. */
export const vocabLabelParams = z.object({
  words: z
    .array(
      z.object({
        /** Names the word in the answer; Rust gives its id. */
        id: z.string(),
        /** The English word, as it is stored. */
        lemma: z.string(),
        /** The sentence of the book it was taken from. */
        sentence: z.string(),
      }),
    )
    .min(1),
});
export type VocabLabelParams = z.infer<typeof vocabLabelParams>;

/** The model's labels; a word without one is asked about again. */
export const vocabLabelsSchema = z.object({
  labels: z.array(
    z.object({
      id: z.string(),
      partOfSpeech: partOfSpeechSchema,
      /** A verb or a phrasal verb that takes an object in its sentence. */
      transitive: z.boolean(),
      /** The form a verb has in its sentence; null for any other word. */
      verbForm: verbFormSchema.nullable(),
    }),
  ),
});
export type VocabLabels = z.infer<typeof vocabLabelsSchema>;

// ── sentences a word is asked with ────────────────────────────────────────

const sentenceWordSchema = z.object({
  /** Names the word in the answer; Rust gives its key. */
  id: z.string(),
  /** The English base form. */
  lemma: z.string(),
  partOfSpeech: partOfSpeechSchema.nullable(),
  /** What it means, in the learner's language. */
  translations: z.array(z.string()),
  /** A sentence that fixes the sense the word has in its chapter. */
  sense: z.string(),
  /** Sentences of the book that have the word, to be glossed. */
  book: z.array(z.string()).min(1),
});

/** No sentence is written: the model glosses those the book has. */
export const sentenceWriteParams = z.object({
  nativeLang: z.string(),
  words: z.array(sentenceWordSchema).min(1),
});
export type SentenceWriteParams = z.infer<typeof sentenceWriteParams>;

const bookGlossSchema = z.object({
  index: z.number().int().min(0),
  /** The words of `translation` that stand for the word, copied from it. */
  hint: z.string(),
  translation: z.string(),
});

const writtenWordSchema = z.object({
  id: z.string(),
  book: z.array(bookGlossSchema),
});

/** What the model labels; what is kept is decided in `books::sentences`. */
export const sentencesWrittenSchema = z.object({
  words: z.array(writtenWordSchema),
});
export type SentencesWritten = z.infer<typeof sentencesWrittenSchema>;

const reviewedSentenceSchema = z.object({
  id: z.string(),
  lemma: z.string(),
  meaning: z.array(z.string()),
  sentence: z.string(),
  form: z.string(),
  hint: z.string(),
  translation: z.string(),
});

export const sentenceReviewParams = z.object({
  nativeLang: z.string(),
  sentences: z.array(reviewedSentenceSchema).min(1),
});
export type SentenceReviewParams = z.infer<typeof sentenceReviewParams>;

const sentenceVerdictSchema = z.object({
  id: z.string(),
  good: z.boolean(),
  /** The other English words the hint could be answered with. */
  also: z.array(z.string()),
  /** The word's other translations, in the form the hint has. */
  hints: z.array(z.string()),
  /** The form a verb has in the sentence; null for any other word. */
  verbForm: verbFormSchema.nullable(),
});

/** The model's labels; a sentence without a good one is not used. */
export const sentenceVerdictsSchema = z.object({
  verdicts: z.array(sentenceVerdictSchema),
});
export type SentenceVerdicts = z.infer<typeof sentenceVerdictsSchema>;

// ── chapter translation ───────────────────────────────────────────────────

/** Which way a chapter is translated: into the learner's language, or back. */
export const translationDirectionSchema = z.enum(["toNative", "toEnglish"]);

export const chapterBriefParams = z.object({
  nativeLang: z.string(),
  /** The chapter, as plain English text. */
  text: z.string().min(1),
});
export type ChapterBriefParams = z.infer<typeof chapterBriefParams>;

export const chapterBriefSchema = z.object({
  /** What a reviewer of any paragraph needs to know of the chapter. */
  brief: z.string().min(1),
});
export type ChapterBrief = z.infer<typeof chapterBriefSchema>;

export const paragraphVersionParams = z.object({
  nativeLang: z.string(),
  brief: z.string(),
  /** The paragraph, a sentence each, in order. */
  sentences: z.array(z.string().min(1)).min(1),
});
export type ParagraphVersionParams = z.infer<typeof paragraphVersionParams>;

export const paragraphVersionSchema = z.object({
  /** One per sentence given, in the same order. Rust checks the count. */
  sentences: z.array(z.string()),
});
export type ParagraphVersion = z.infer<typeof paragraphVersionSchema>;

export const paragraphReviewParams = z.object({
  nativeLang: z.string(),
  level: levelSchema,
  direction: translationDirectionSchema,
  /** The learner asked for accents and spelling to count. */
  strictSpelling: z.boolean(),
  brief: z.string(),
  /** The paragraph before this one, in English; empty for the first. */
  previous: z.string(),
  sentences: z
    .array(
      z.object({
        /** The author's sentence. */
        english: z.string(),
        /** What the learner was shown instead, translating back into English. */
        native: z.string().nullable(),
        /** What the learner wrote. */
        attempt: z.string(),
      }),
    )
    .min(1),
});
export type ParagraphReviewParams = z.infer<typeof paragraphReviewParams>;

/** How much a note weighs: a wrong translation, or a slip of the pen. */
export const severitySchema = z.enum(["error", "slip"]);

/** An English word or expression, with its translations for one sense. */
const noteWordSchema = z.object({
  english: z.string(),
  translations: z.array(z.string()),
});

const reviewNoteSchema = z.object({
  /** Which sentence, counted from 0. */
  sentence: z.number().int().min(0),
  /** The words of the learner's sentence that are wrong, copied exactly. */
  fragment: z.string(),
  /** `error`: mistranslated or wrong. `slip`: misspelled, or a small detail. */
  severity: severitySchema,
  /** What the fragment should have been, in the language it was written in. */
  better: z.string(),
  /** Why, in the learner's language. */
  why: z.string(),
  /**
   * The English word or expression the note is about, when it is about one
   * the learner did not know: its base form, and its translations in the
   * learner's language for the sense it has here. Null otherwise.
   */
  word: noteWordSchema.nullable(),
});

export const paragraphReviewSchema = z.object({
  /** One thing done well, in the learner's language; null when none stands out. */
  good: z.string().nullable(),
  /** Rust places each one in the learner's text and scores the paragraph. */
  notes: z.array(reviewNoteSchema),
});
export type ParagraphReview = z.infer<typeof paragraphReviewSchema>;

export const attemptSummaryParams = z.object({
  nativeLang: z.string(),
  level: levelSchema,
  direction: translationDirectionSchema,
  /** Every note of every paragraph of the attempt, in reading order. */
  notes: z
    .array(
      z.object({
        fragment: z.string(),
        severity: severitySchema,
        better: z.string(),
        why: z.string(),
      }),
    )
    .min(1),
});
export type AttemptSummaryParams = z.infer<typeof attemptSummaryParams>;

/** A mistake that came back: the same kind of error, several times. */
const habitSchema = z.object({
  /** What the learner keeps doing, in a few words. */
  habit: z.string(),
  /** What to do instead, in one or two lines. */
  advice: z.string(),
  /** Fragments the learner wrote that show it, copied from the notes. */
  examples: z.array(z.string()),
});

export const attemptSummarySchema = z.object({
  /** What matters most of the whole attempt, in the learner's language. */
  points: z.array(z.string()),
  habits: z.array(habitSchema),
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;

// ── structures ────────────────────────────────────────────────────────────

/** One structure of the catalogue (`src-tauri/src/structures`), in English. */
const structureRefSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  /** How it is built: "have / has + past participle". */
  form: z.string(),
  /** What it is used for. */
  use: z.string(),
});

export const structureGradeParams = z.object({
  nativeLang: z.string(),
  level: levelSchema,
  variant: z.enum(["us", "uk"]),
  structure: structureRefSchema,
  /** The word the learner was asked to use; null when none was. */
  word: z.string().nullable(),
  /** What kind of word it is; null when none was asked or nobody said. */
  partOfSpeech: partOfSpeechSchema.nullable(),
  /** The sentence as the learner typed it; empty for "I don't know". */
  answer: z.string(),
});
export type StructureGradeParams = z.infer<typeof structureGradeParams>;

/** The model's labels; the verdict is decided in `structures::verdict`. */
export const structureGradeSchema = z.object({
  usesStructure: z.boolean(),
  /** The structure itself is formed correctly. */
  wellFormed: z.boolean(),
  usesWord: z.boolean(),
  /** A mistake outside the structure. */
  slips: z.boolean(),
  /** One or two lines, in the learner's language. */
  explanation: z.string().min(1),
  /** A right sentence with the structure, close to the learner's. */
  better: z.string().min(1),
});
export type StructureGrade = z.infer<typeof structureGradeSchema>;

export const structureDetectParams = z.object({
  structures: z.array(structureRefSchema).min(1),
  /** One piece of a chapter, as plain English text. */
  text: z.string().min(1),
});
export type StructureDetectParams = z.infer<typeof structureDetectParams>;

/** The model's labels; Rust counts them over the chapter and ranks. */
export const structuresFoundSchema = z.object({
  found: z.array(
    z.object({
      key: z.string(),
      /** Sentences of the piece that use it. */
      count: z.number().int().min(1),
      /** One of them, copied from the text. */
      sentence: z.string(),
    }),
  ),
});
export type StructuresFound = z.infer<typeof structuresFoundSchema>;
