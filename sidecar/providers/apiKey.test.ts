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
    retrieveModel: async () => {},
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
    const provider = new ApiKeyProvider(api, "claude-sonnet-5");

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
    const provider = new ApiKeyProvider(api, "claude-sonnet-5");

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
    const provider = new ApiKeyProvider(api, "claude-sonnet-5");

    const failure = provider.structured(task);
    await expect(failure).rejects.toBeInstanceOf(AgentError);
    await expect(failure).rejects.toMatchObject({ kind: "provider" });
  });

  test("reports a truncated answer instead of parsing it", async () => {
    const { api } = scripted([reply('{"corr', "max_tokens")]);
    const provider = new ApiKeyProvider(api, "claude-sonnet-5");

    await expect(provider.structured(task)).rejects.toThrow(/cut off/u);
  });

  test("sends no effort to Haiku, which rejects it", async () => {
    const { api, sent } = scripted([reply('{"correct":true,"hint":null}')]);
    const provider = new ApiKeyProvider(api, "claude-haiku-4-5-20251001");

    await provider.structured(task);
    expect(sent[0]?.output_config?.effort).toBeUndefined();
    expect(sent[0]?.thinking).toEqual({ type: "disabled" });
  });
});

describe("ApiKeyProvider.chat", () => {
  test("streams deltas and opens with the kickoff turn", async () => {
    const { api, sent } = scripted([]);
    const provider = new ApiKeyProvider(api, "claude-sonnet-5");
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
    expect(sent[0]?.thinking).toEqual({ type: "disabled" });
    expect(sent[0]?.cache_control).toEqual({ type: "ephemeral" });
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
