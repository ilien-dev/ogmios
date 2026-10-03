import type {
  Analysis,
  AnalyzeParams,
  CheckResult,
  ComposeParams,
  Composed,
  DrillGenerateParams,
  DrillSet,
  ModelsResult,
  Vocab,
  VocabExtractParams,
  VocabJudgeParams,
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
          translations: [`${lemma} (${params.nativeLang})`],
          properNoun: form !== lemma,
          needsContext: false,
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
