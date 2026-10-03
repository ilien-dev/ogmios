import type {
  Analysis,
  AnalyzeParams,
  ChatResult,
  CheckResult,
  ComposeParams,
  Composed,
  DrillGenerateParams,
  DrillSet,
  ModelsResult,
} from "../../shared/protocol.ts";
import { AgentError } from "../errors.ts";
import type {
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

  chat(task: ChatTask, onDelta: DeltaSink): Promise<ChatResult> {
    const text =
      task.history.length === 0
        ? openingFor(task)
        : "Oh really? That sounds interesting. What happened next?";
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
