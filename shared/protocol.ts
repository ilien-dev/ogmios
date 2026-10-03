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
/** `configure` answers with `null` once the provider is in place. */
export type ConfigureResult = null;

export interface CheckResult {
  ok: boolean;
  message: string | null;
}

/** `models` takes no params and lists what the configured provider offers. */
export type ModelsResult = ModelOption[];

// ── chat ──────────────────────────────────────────────────────────────────

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
});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const chatParams = z.object({
  context: chatContextSchema,
  /**
   * Every turn so far, oldest first, ending with the learner's new turn.
   * Empty for the opening question.
   */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
    .refine((turns) => turns.length === 0 || turns.at(-1)?.role === "user", {
      message: "history must end with the learner's turn",
    }),
  /** Claude Code session id from the previous turn, when the mode keeps one. */
  providerRef: z.string().nullable(),
});
export type ChatParams = z.infer<typeof chatParams>;

export interface ChatResult {
  text: string;
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
    .object({ original: z.string(), rewrite: z.string() })
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
