import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type {
  EffortCapability,
  ModelInfo,
} from "@anthropic-ai/sdk/resources/models";
import type { Effort } from "../../shared/domain.ts";
import type {
  ChatResult,
  CheckResult,
  ModelsResult,
} from "../../shared/protocol.ts";
import { AgentError, providerError } from "../errors.ts";
import { log } from "../log.ts";
import { apiModels, modelKnobs } from "./models.ts";
import type {
  ChatTask,
  DeltaSink,
  Provider,
  StructuredTask,
} from "./provider.ts";
import { firstIssues, outputSchema, parseStructured } from "./structured.ts";

/**
 * The calls this provider makes, behind a seam so the tests can answer them
 * without a network.
 */
export interface MessagesApi {
  create: (params: MessageCreateParamsNonStreaming) => Promise<Message>;
  stream: (
    params: MessageCreateParamsNonStreaming,
    onText: DeltaSink,
  ) => Promise<Message>;
  retrieveModel: (model: string) => Promise<ModelInfo>;
  listModels: () => Promise<ModelInfo[]>;
}

export function messagesApi(apiKey: string): MessagesApi {
  const client = new Anthropic({ apiKey });
  return {
    create: (params) => client.messages.create(params),
    stream: (params, onText) =>
      client.messages.stream(params).on("text", onText).finalMessage(),
    retrieveModel: (model) => client.models.retrieve(model),
    listModels: async () => {
      const models: ModelInfo[] = [];
      for await (const model of client.models.list()) {
        models.push(model);
      }
      return models;
    },
  };
}

const CHAT_MAX_TOKENS = 1024;
/** Thinking counts against `max_tokens`; a chosen effort may think at length. */
const THINKING_HEADROOM = 8192;
/** Past this the SDK refuses a call that is not streamed. */
const UNSTREAMED_MAX_TOKENS = 21_000;

/** The system prompt as one cached block: it is identical on every turn. */
function cachedSystem(system: string): TextBlockParam[] {
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

/**
 * `supported` is the model's effort capability, null when unknown. An older
 * model in the key's list may take no effort, or not this level: then none
 * is sent rather than a request that fails.
 */
function knobs(
  model: string,
  purpose: "chat" | "structured",
  chosen: Effort | null,
  supported: EffortCapability | null,
): Pick<MessageCreateParamsNonStreaming, "thinking" | "output_config"> {
  const { thinking, effort } = modelKnobs(model, purpose, chosen);
  const allowed =
    effort !== null &&
    (supported === null ||
      (supported.supported && supported[effort]?.supported === true));
  return {
    ...(thinking === false ? { thinking: { type: "disabled" } } : {}),
    ...(allowed ? { output_config: { effort } } : {}),
  };
}

function textOf(message: Message): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

function checkStop(message: Message): void {
  if (message.stop_reason === "refusal") {
    throw providerError("Claude declined to answer this request.");
  }
  if (message.stop_reason === "max_tokens") {
    throw providerError("Claude's answer was cut off before it finished.");
  }
}

function logUsage(method: string, message: Message): void {
  log("usage", { method, model: message.model, usage: message.usage });
}

/** Turns the SDK's typed errors into sentences a learner can act on. */
export function describeApiError(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error;
  }
  if (error instanceof AuthenticationError) {
    return providerError("The API key was rejected. Check it in Settings.");
  }
  if (error instanceof PermissionDeniedError) {
    return providerError("This API key is not allowed to use that model.");
  }
  if (error instanceof NotFoundError) {
    return providerError("That model was not found. Pick another in Settings.");
  }
  if (error instanceof RateLimitError) {
    return providerError("Rate limit reached. Wait a minute and try again.");
  }
  if (error instanceof InternalServerError) {
    return providerError("Claude is overloaded right now. Try again shortly.");
  }
  if (error instanceof APIConnectionError) {
    return providerError("Could not reach the Claude API. Check the network.");
  }
  if (error instanceof APIError) {
    return providerError(
      `The Claude API refused the request: ${error.message}`,
    );
  }
  return new AgentError("internal", String(error), { cause: error });
}

export class ApiKeyProvider implements Provider {
  readonly #api: MessagesApi;
  readonly #model: string;
  readonly #effort: Effort | null;
  #effortSupport: EffortCapability | null | undefined;

  constructor(api: MessagesApi, model: string, effort: Effort | null) {
    this.#api = api;
    this.#model = model;
    this.#effort = effort;
  }

  /** Asked once; a failure leaves it unknown and asks again next call. */
  async #supportedEffort(): Promise<EffortCapability | null> {
    if (this.#effortSupport === undefined) {
      try {
        const info = await this.#api.retrieveModel(this.#model);
        this.#effortSupport = info.capabilities?.effort ?? null;
      } catch {
        return null;
      }
    }
    return this.#effortSupport;
  }

  #maxTokens(base: number): number {
    return this.#effort === null
      ? base
      : Math.min(base + THINKING_HEADROOM, UNSTREAMED_MAX_TOKENS);
  }

  async check(): Promise<CheckResult> {
    try {
      await this.#api.retrieveModel(this.#model);
      return { ok: true, message: null };
    } catch (error) {
      return { ok: false, message: describeApiError(error).message };
    }
  }

  async models(): Promise<ModelsResult> {
    try {
      return apiModels(await this.#api.listModels());
    } catch (error) {
      throw describeApiError(error);
    }
  }

  async chat(task: ChatTask, onDelta: DeltaSink): Promise<ChatResult> {
    const messages: MessageParam[] =
      task.history.length === 0
        ? [{ role: "user", content: task.kickoff }]
        : task.history.map((turn) => ({ role: turn.role, content: turn.text }));
    // A partner that speaks first leaves the history starting with its turn.
    if (messages[0]?.role === "assistant") {
      messages.unshift({ role: "user", content: task.kickoff });
    }
    try {
      const supported = await this.#supportedEffort();
      const message = await this.#api.stream(
        {
          model: this.#model,
          max_tokens: this.#maxTokens(CHAT_MAX_TOKENS),
          system: cachedSystem(task.system),
          // Caches the conversation so far, so each turn pays for one turn.
          cache_control: { type: "ephemeral" },
          messages,
          ...knobs(this.#model, "chat", this.#effort, supported),
        },
        onDelta,
      );
      logUsage("chat", message);
      checkStop(message);
      return { text: textOf(message).trim(), providerRef: null };
    } catch (error) {
      throw describeApiError(error);
    }
  }

  async structured<T>(task: StructuredTask<T>): Promise<T> {
    const schema = outputSchema(task.schema);
    const base = knobs(
      this.#model,
      "structured",
      this.#effort,
      await this.#supportedEffort(),
    );
    const params = (
      messages: MessageParam[],
    ): MessageCreateParamsNonStreaming => ({
      model: this.#model,
      max_tokens: this.#maxTokens(task.maxTokens),
      system: cachedSystem(task.system),
      messages,
      ...base,
      output_config: {
        ...base.output_config,
        format: { type: "json_schema", schema },
      },
    });
    const messages: MessageParam[] = [{ role: "user", content: task.user }];
    try {
      const first = await this.#api.create(params(messages));
      logUsage(task.request.method, first);
      checkStop(first);
      const parsed = parseStructured(task.schema, textOf(first));
      if (parsed.ok) {
        return parsed.value;
      }
      log("retrying after invalid output", { method: task.request.method });
      // One retry, with what was wrong, before giving up on the call.
      messages.push(
        { role: "assistant", content: textOf(first) },
        { role: "user", content: retryPrompt(parsed.issues) },
      );
      const second = await this.#api.create(params(messages));
      logUsage(task.request.method, second);
      checkStop(second);
      const reparsed = parseStructured(task.schema, textOf(second));
      if (reparsed.ok) {
        return reparsed.value;
      }
      throw providerError(
        `Claude's answer did not match the expected format: ${firstIssues(reparsed.issues)}`,
      );
    } catch (error) {
      throw describeApiError(error);
    }
  }
}

export function retryPrompt(issues: string): string {
  return `That JSON failed validation:\n${issues}\nReturn the whole corrected JSON document.`;
}
