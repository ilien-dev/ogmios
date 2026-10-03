import type { z } from "zod";

import {
  analysisSchema,
  analyzeParams,
  chatParams,
  composeParams,
  composedSchema,
  configureParams,
  drillGenerateParams,
  drillGradeParams,
  drillGradeSchema,
  drillSetSchema,
  helpParams,
  helpResultSchema,
  requestSchema,
  selfCheckParams,
  selfCheckSchema,
  vocabExtractParams,
  vocabJudgeParams,
  vocabSchema,
  vocabVerdictSchema,
} from "../shared/protocol.ts";
import type {
  ChatParams,
  ChatResult,
  ConfigureParams,
  Outgoing,
} from "../shared/protocol.ts";
import { AgentError } from "./errors.ts";
import { log } from "./log.ts";
import { analyzeSystemPrompt, analyzeUserPrompt } from "./prompts/analyze.ts";
import { KICKOFF, chatSystemPrompt } from "./prompts/chat.ts";
import {
  drillGenerateSystemPrompt,
  drillGenerateUserPrompt,
  drillGradeSystemPrompt,
  drillGradeUserPrompt,
} from "./prompts/drills.ts";
import {
  composeSystemPrompt,
  composeUserPrompt,
  helpSystemPrompt,
  helpUserPrompt,
  selfCheckSystemPrompt,
  selfCheckUserPrompt,
} from "./prompts/feedback.ts";
import {
  vocabExtractSystemPrompt,
  vocabExtractUserPrompt,
  vocabJudgeSystemPrompt,
  vocabJudgeUserPrompt,
} from "./prompts/vocab.ts";
import type { Provider } from "./providers/provider.ts";
import {
  sanitizeAnalysis,
  sanitizeComposed,
  sanitizeDrills,
} from "./sanitize.ts";
import { hideStarters, splitStarters } from "./starters.ts";

export type Emit = (message: Outgoing) => void;
export type ProviderFactory = (config: ConfigureParams) => Provider;

/** Output ceilings per call: an analysis of a long session is long. */
const MAX_TOKENS = {
  help: 1024,
  analyze: 16_000,
  compose: 4096,
  selfCheck: 1024,
  drillGenerate: 8192,
  drillGrade: 1024,
  vocabExtract: 16_000,
  vocabJudge: 1024,
} as const;

function parseParams<T>(schema: z.ZodType<T>, method: string, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "params"}: ${issue.message}`)
    .join("; ");
  throw new AgentError("invalid", `Invalid params for ${method}: ${issues}`);
}

function checkConfig(config: ConfigureParams): void {
  if (config.mode === "apiKey" && (config.apiKey ?? "") === "") {
    throw new AgentError("invalid", "An API key is required for this mode.");
  }
  if (config.mode === "claudeCode" && (config.claudePath ?? "") === "") {
    throw new AgentError("invalid", "The path to Claude Code is required.");
  }
}

/**
 * Routes one request to its handler. Holds the provider chosen by the last
 * `configure` and nothing else: Rust sends everything a call needs.
 */
export class Dispatcher {
  #provider: Provider | null;
  readonly #factory: ProviderFactory;

  constructor(factory: ProviderFactory, initial: Provider | null) {
    this.#factory = factory;
    this.#provider = initial;
  }

  #requireProvider(): Provider {
    if (this.#provider === null) {
      throw new AgentError("invalid", "The agent is not configured yet.");
    }
    return this.#provider;
  }

  /** Handles one input line, writing its events and exactly one response. */
  async handleLine(line: string, emit: Emit): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      log("ignored a line that is not JSON", { line: line.slice(0, 200) });
      return;
    }
    const request = requestSchema.safeParse(raw);
    if (!request.success) {
      log("ignored a malformed request", { line: line.slice(0, 200) });
      return;
    }
    const { id, method, params } = request.data;
    try {
      const result = await this.#call(method, params, (text) => {
        emit({ id, event: "delta", text });
      });
      emit({ id, result });
    } catch (error) {
      const failure =
        error instanceof AgentError
          ? error
          : new AgentError("internal", String(error), { cause: error });
      if (failure.kind === "internal") {
        log("internal error", { method, error: String(error) });
      }
      emit({ id, error: { kind: failure.kind, message: failure.message } });
    }
  }

  #call(
    method: string,
    raw: unknown,
    onDelta: (text: string) => void,
  ): Promise<unknown> {
    switch (method) {
      case "configure": {
        const config = parseParams(configureParams, method, raw);
        checkConfig(config);
        this.#provider = this.#factory(config);
        return Promise.resolve(null);
      }
      case "check":
        return this.#requireProvider().check();
      case "models":
        return this.#requireProvider().models();
      case "chat": {
        const params = parseParams(chatParams, method, raw);
        return this.#chat(params, onDelta);
      }
      default:
        return this.#structured(method, raw);
    }
  }

  async #chat(
    params: ChatParams,
    onDelta: (text: string) => void,
  ): Promise<ChatResult> {
    const stream = hideStarters(onDelta);
    const reply = await this.#requireProvider().chat(
      {
        context: params.context,
        system: chatSystemPrompt(params.context),
        history: params.history,
        providerRef: params.providerRef,
        kickoff: KICKOFF,
      },
      stream.push,
    );
    stream.finish();
    return { ...reply, ...splitStarters(reply.text) };
  }

  async #structured(method: string, raw: unknown): Promise<unknown> {
    const provider = this.#requireProvider();
    switch (method) {
      case "help": {
        const params = parseParams(helpParams, method, raw);
        return provider.structured({
          request: { method, params },
          system: helpSystemPrompt(params),
          user: helpUserPrompt(params),
          schema: helpResultSchema,
          maxTokens: MAX_TOKENS.help,
        });
      }
      case "analyze": {
        const params = parseParams(analyzeParams, method, raw);
        const analysis = await provider.structured({
          request: { method, params },
          system: analyzeSystemPrompt(params.nativeLang),
          user: analyzeUserPrompt(params),
          schema: analysisSchema,
          maxTokens: MAX_TOKENS.analyze,
        });
        return sanitizeAnalysis(analysis, params);
      }
      case "compose": {
        const params = parseParams(composeParams, method, raw);
        const composed = await provider.structured({
          request: { method, params },
          system: composeSystemPrompt(params),
          user: composeUserPrompt(params),
          schema: composedSchema,
          maxTokens: MAX_TOKENS.compose,
        });
        return sanitizeComposed(composed, params);
      }
      case "selfCheck": {
        const params = parseParams(selfCheckParams, method, raw);
        return provider.structured({
          request: { method, params },
          system: selfCheckSystemPrompt(params.nativeLang),
          user: selfCheckUserPrompt(params),
          schema: selfCheckSchema,
          maxTokens: MAX_TOKENS.selfCheck,
        });
      }
      case "drillGenerate": {
        const params = parseParams(drillGenerateParams, method, raw);
        const drills = await provider.structured({
          request: { method, params },
          system: drillGenerateSystemPrompt(params),
          user: drillGenerateUserPrompt(params),
          schema: drillSetSchema,
          maxTokens: MAX_TOKENS.drillGenerate,
        });
        return sanitizeDrills(drills, params);
      }
      case "drillGrade": {
        const params = parseParams(drillGradeParams, method, raw);
        return provider.structured({
          request: { method, params },
          system: drillGradeSystemPrompt(params.nativeLang),
          user: drillGradeUserPrompt(params),
          schema: drillGradeSchema,
          maxTokens: MAX_TOKENS.drillGrade,
        });
      }
      case "vocabExtract": {
        const params = parseParams(vocabExtractParams, method, raw);
        return provider.structured({
          request: { method, params },
          system: vocabExtractSystemPrompt(params),
          user: vocabExtractUserPrompt(params),
          schema: vocabSchema,
          maxTokens: MAX_TOKENS.vocabExtract,
        });
      }
      case "vocabJudge": {
        const params = parseParams(vocabJudgeParams, method, raw);
        return provider.structured({
          request: { method, params },
          system: vocabJudgeSystemPrompt(params),
          user: vocabJudgeUserPrompt(params),
          schema: vocabVerdictSchema,
          maxTokens: MAX_TOKENS.vocabJudge,
        });
      }
      default:
        throw new AgentError("invalid", `Unknown method: ${method}`);
    }
  }
}
