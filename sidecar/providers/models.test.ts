import { describe, expect, test } from "bun:test";

import type { ModelInfo as ApiModel } from "@anthropic-ai/sdk/resources/models";
import type { ModelInfo as CliModel } from "@anthropic-ai/claude-agent-sdk";
import { apiModels, claudeCodeModels, modelKnobs } from "./models.ts";

const ALL = ["low", "medium", "high", "xhigh", "max"] as const;

/** What Claude Code 2.1.288 answered to `supportedModels()`, trimmed. */
const CLI: CliModel[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default (recommended)",
    description: "Opus 5.5 · Best for everyday, complex tasks",
    supportsEffort: true,
    supportedEffortLevels: [...ALL],
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    description: "Opus 5.5 · Best for everyday, complex tasks",
    supportsEffort: true,
    supportedEffortLevels: [...ALL],
  },
  {
    value: "claude-fable-5-1[1m]",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    description: "Fable 5.1 · Most capable for your hardest tasks",
    supportsEffort: true,
    supportedEffortLevels: [...ALL],
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5-5",
    displayName: "Sonnet",
    description: "Sonnet 5.5 · Efficient for routine tasks",
    supportsEffort: true,
    supportedEffortLevels: [...ALL],
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
];

function supported(on: boolean): { supported: boolean } {
  return { supported: on };
}

function api(
  id: string,
  options: { efforts?: readonly string[]; structured?: boolean } = {},
): ApiModel {
  const efforts = options.efforts ?? [];
  const level = (name: string) => supported(efforts.includes(name));
  return {
    type: "model",
    id,
    display_name: id.replace("claude-", ""),
    created_at: "2026-01-01T00:00:00Z",
    max_input_tokens: null,
    max_tokens: null,
    capabilities: {
      structured_outputs: supported(options.structured ?? true),
      effort: {
        supported: efforts.length > 0,
        low: level("low"),
        medium: level("medium"),
        high: level("high"),
        xhigh: level("xhigh"),
        max: level("max"),
      },
    },
  } as ApiModel;
}

describe("claudeCodeModels", () => {
  test("lists each model once, by the alias Claude Code resolves", () => {
    expect(claudeCodeModels(CLI)).toEqual([
      {
        id: "opus",
        name: "Opus",
        description: "Opus 5.5 · Best for everyday, complex tasks",
        efforts: [...ALL],
      },
      {
        id: "claude-fable-5-1[1m]",
        name: "Fable",
        description: "Fable 5.1 · Most capable for your hardest tasks",
        efforts: [...ALL],
      },
      {
        id: "sonnet",
        name: "Sonnet",
        description: "Sonnet 5.5 · Efficient for routine tasks",
        efforts: [...ALL],
      },
      {
        id: "haiku",
        name: "Haiku",
        description: "Haiku 4.5 · Fastest for quick answers",
        efforts: [],
      },
    ]);
  });
});

describe("apiModels", () => {
  test("leaves out models that cannot answer in JSON", () => {
    const models = apiModels([
      api("claude-sonnet-5-5", { efforts: ["low", "medium", "high"] }),
      api("claude-haiku-4-5-20251001"),
      api("claude-3-haiku-20240307", { structured: false }),
      { ...api("claude-unknown"), capabilities: null },
    ]);
    expect(models).toEqual([
      {
        id: "claude-sonnet-5-5",
        name: "sonnet-5-5",
        description: null,
        efforts: ["low", "medium", "high"],
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "haiku-4-5-20251001",
        description: null,
        efforts: [],
      },
      {
        id: "claude-unknown",
        name: "unknown",
        description: null,
        efforts: [],
      },
    ]);
  });
});

describe("modelKnobs", () => {
  test("by default, chat is fast and analysis thinks a little", () => {
    expect(modelKnobs("sonnet", "chat", null)).toEqual({
      thinking: null,
      effort: "low",
    });
    expect(modelKnobs("claude-sonnet-5-5", "structured", null)).toEqual({
      thinking: null,
      effort: "medium",
    });
    expect(modelKnobs("claude-fable-5-1[1m]", "chat", null)).toEqual({
      thinking: null,
      effort: "low",
    });
    expect(modelKnobs("opus", "structured", null)).toEqual({
      thinking: null,
      effort: "medium",
    });
  });

  test("the learner's effort applies to every call and lets the model think", () => {
    expect(modelKnobs("sonnet", "chat", "high")).toEqual({
      thinking: null,
      effort: "high",
    });
    expect(modelKnobs("opus", "structured", "max")).toEqual({
      thinking: null,
      effort: "max",
    });
  });

  test("Haiku never gets an effort, whatever is stored", () => {
    expect(modelKnobs("haiku", "chat", "high")).toEqual({
      thinking: false,
      effort: null,
    });
  });

  test("an unknown model gets the chosen effort and nothing else", () => {
    expect(modelKnobs("claude-next", "chat", null)).toEqual({
      thinking: null,
      effort: null,
    });
    expect(modelKnobs("claude-next", "chat", "medium")).toEqual({
      thinking: null,
      effort: "medium",
    });
  });
});
