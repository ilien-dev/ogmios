import { AuthenticationError, RateLimitError } from "@anthropic-ai/sdk";
import { describe, expect, test } from "bun:test";

import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";
import { selfCheckSchema } from "../../shared/protocol.ts";
import { AgentError } from "../errors.ts";
import { ApiKeyProvider, describeApiError } from "./apiKey.ts";
import type { MessagesApi } from "./apiKey.ts";
import type { StructuredTask } from "./provider.ts";

function reply(
  text: string,
  stop: Message["stop_reason"] = "end_turn",
): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as Message;
}

/** Answers `create` from a script, recording every request it was sent. */
function scripted(answers: Message[]): {
  api: MessagesApi;
  sent: MessageCreateParamsNonStreaming[];
} {
  const sent: MessageCreateParamsNonStreaming[] = [];
  const api: MessagesApi = {
    create: async (params) => {
      sent.push(params);
      const next = answers.shift();
      if (next === undefined) {
        throw new Error("no scripted answer left");
      }
      return next;
    },
    stream: async (params, onText) => {
      sent.push(params);
      onText("Hi ");
      onText("there!");
      return reply("Hi there!");
    },
    retrieveModel: async (id) => ({
      type: "model",
      id,
      display_name: id,
      created_at: "2026-01-01T00:00:00Z",
      max_input_tokens: null,
      max_tokens: null,
      capabilities: null,
    }),
    listModels: async () => [],
  };
  return { api, sent };
}

const task: StructuredTask<{ correct: boolean; hint: string | null }> = {
  request: {
    method: "selfCheck",
    params: {
      nativeLang: "es",
      original: "I goed",
      corrected: "I went",
      attempt: "I went",
    },
  },
  system: "SYSTEM",
  user: "USER",
  schema: selfCheckSchema,
  maxTokens: 512,
};

describe("ApiKeyProvider.structured", () => {
  test("asks for JSON matching the schema and caches the system prompt", async () => {
    const { api, sent } = scripted([reply('{"correct":true,"hint":null}')]);
    const provider = new ApiKeyProvider(api, "claude-sonnet-5", null);

    expect(await provider.structured(task)).toEqual({
      correct: true,
      hint: null,
    });

    const params = sent[0];
    expect(params?.output_config?.format?.type).toBe("json_schema");
    expect(params?.output_config?.format?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(params?.output_config?.effort).toBe("medium");
    expect(params?.tool_choice).toBeUndefined();
    expect(params?.system).toEqual([
      { type: "text", text: "SYSTEM", cache_control: { type: "ephemeral" } },
    ]);
  });

  test("retries once with the validation error fed back", async () => {
    const { api, sent } = scripted([
      reply('{"correct":"yes"}'),
      reply('{"correct":false,"hint":"Look at the verb."}'),
    ]);
    const provider = new ApiKeyProvider(api, "claude-sonnet-5", null);

    expect(await provider.structured(task)).toEqual({
      correct: false,
      hint: "Look at the verb.",
    });
    expect(sent).toHaveLength(2);
    const retry = sent[1]?.messages ?? [];
    expect(retry.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(retry[2]?.content).toEqual(expect.stringContaining("correct"));
  });

  test("gives up after the retry with a provider error", async () => {
    const { api } = scripted([reply("not json"), reply("{}")]);
    const provider = new ApiKeyProvider(api, "claude-sonnet-5", null);

    const failure = provider.structured(task);
    await expect(failure).rejects.toBeInstanceOf(AgentError);
    await expect(failure).rejects.toMatchObject({ kind: "provider" });
  });

  test("reports a truncated answer instead of parsing it", async () => {
    const { api } = scripted([reply('{"corr', "max_tokens")]);
    const provider = new ApiKeyProvider(api, "claude-sonnet-5", null);

    await expect(provider.structured(task)).rejects.toThrow(/cut off/u);
  });

  test("sends no effort to Haiku, which rejects it", async () => {
    const { api, sent } = scripted([reply('{"correct":true,"hint":null}')]);
    const provider = new ApiKeyProvider(api, "claude-haiku-4-5-20251001", null);

    await provider.structured(task);
    expect(sent[0]?.output_config?.effort).toBeUndefined();
    expect(sent[0]?.thinking).toEqual({ type: "disabled" });
  });
});

describe("ApiKeyProvider.chat", () => {
  test("streams deltas and opens with the kickoff turn", async () => {
    const { api, sent } = scripted([]);
    const provider = new ApiKeyProvider(api, "claude-sonnet-5", null);
    const deltas: string[] = [];

    const result = await provider.chat(
      {
        context: {} as never,
        system: "PARTNER",
        history: [],
        providerRef: null,
        kickoff: "KICKOFF",
      },
      (text) => deltas.push(text),
    );

    expect(deltas).toEqual(["Hi ", "there!"]);
    expect(result).toEqual({ text: "Hi there!", providerRef: null });
    expect(sent[0]?.messages).toEqual([{ role: "user", content: "KICKOFF" }]);
    // Sonnet 5.5 rejects thinking off; low effort keeps the partner quick.
    expect(sent[0]?.thinking).toBeUndefined();
    expect(sent[0]?.output_config?.effort).toBe("low");
    expect(sent[0]?.cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("ApiKeyProvider effort", () => {
  test("sends the learner's effort on every call and lets the model think", async () => {
    const { api, sent } = scripted([reply('{"correct":true,"hint":null}')]);
    const provider = new ApiKeyProvider(api, "claude-sonnet-5-5", "high");

    await provider.structured(task);
    await provider.chat(
      {
        context: {} as never,
        system: "PARTNER",
        history: [],
        providerRef: null,
        kickoff: "KICKOFF",
      },
      () => {},
    );
    for (const params of sent) {
      expect(params.output_config?.effort).toBe("high");
      expect(params.thinking).toBeUndefined();
      expect(params.max_tokens).toBeGreaterThan(1024);
    }
  });

  test("sends no effort a model in the key's list cannot take", async () => {
    const { api, sent } = scripted([reply('{"correct":true,"hint":null}')]);
    const retrieve = api.retrieveModel;
    api.retrieveModel = async (id) => {
      const info = await retrieve(id);
      return {
        ...info,
        capabilities: {
          effort: { supported: false },
        } as NonNullable<typeof info.capabilities>,
      };
    };
    const provider = new ApiKeyProvider(api, "claude-sonnet-4-5", null);

    await provider.structured(task);
    expect(sent[0]?.output_config?.effort).toBeUndefined();
  });
});

describe("ApiKeyProvider.models", () => {
  test("lists what the key can use", async () => {
    const { api } = scripted([]);
    api.listModels = async () => [
      {
        type: "model",
        id: "claude-sonnet-5-5",
        display_name: "Claude Sonnet 5.5",
        created_at: "2026-01-01T00:00:00Z",
        max_input_tokens: null,
        max_tokens: null,
        capabilities: null,
      },
    ];
    const provider = new ApiKeyProvider(api, "claude-sonnet-5-5", null);

    expect(await provider.models()).toEqual([
      {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        description: null,
        efforts: [],
      },
    ]);
  });

  test("reports a rejected key as a provider error", async () => {
    const { api } = scripted([]);
    api.listModels = () =>
      Promise.reject(new AuthenticationError(401, {}, "bad", new Headers()));
    const provider = new ApiKeyProvider(api, "claude-sonnet-5-5", null);

    await expect(provider.models()).rejects.toMatchObject({
      kind: "provider",
    });
  });
});

describe("describeApiError", () => {
  test("names the fix for a rejected key and a rate limit", () => {
    const headers = new Headers();
    expect(
      describeApiError(new AuthenticationError(401, {}, "bad key", headers))
        .message,
    ).toMatch(/API key was rejected/u);
    expect(
      describeApiError(new RateLimitError(429, {}, "slow down", headers)).kind,
    ).toBe("provider");
  });
});
