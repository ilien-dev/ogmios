import { describe, expect, test } from "bun:test";

import type { ModelOption, Settings } from "@shared/domain";
import { reconcileModel } from "./models";

const CLAUDE_CODE: ModelOption[] = [
  { id: "opus", name: "Opus", description: null, efforts: ["low", "high"] },
  { id: "sonnet", name: "Sonnet", description: null, efforts: ["low"] },
  { id: "haiku", name: "Haiku", description: null, efforts: [] },
];

const API: ModelOption[] = [
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    description: null,
    efforts: ["low"],
  },
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    description: null,
    efforts: ["low", "medium"],
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    description: null,
    efforts: ["low"],
  },
];

function settings(model: string, effort: Settings["effort"] = null): Settings {
  return {
    providerMode: "claudeCode",
    model,
    effort,
    claudePath: "/bin/claude",
    sttModel: null,
  };
}

describe("reconcileModel", () => {
  test("keeps a model and effort the provider offers", () => {
    const current = settings("opus", "high");
    expect(reconcileModel(CLAUDE_CODE, current)).toBe(current);
  });

  test("moves a model the provider names differently to the same family", () => {
    expect(reconcileModel(API, settings("sonnet")).model).toBe(
      "claude-sonnet-5-5",
    );
    expect(reconcileModel(CLAUDE_CODE, settings("claude-opus-5-5")).model).toBe(
      "opus",
    );
  });

  test("falls back to Sonnet, then to the first model", () => {
    expect(reconcileModel(CLAUDE_CODE, settings("mystery")).model).toBe(
      "sonnet",
    );
    expect(reconcileModel(API.slice(0, 1), settings("mystery")).model).toBe(
      "claude-opus-5-5",
    );
  });

  test("goes back to automatic when the model lacks the effort", () => {
    expect(reconcileModel(CLAUDE_CODE, settings("haiku", "high"))).toEqual(
      settings("haiku", null),
    );
    expect(reconcileModel(API, settings("opus", "high"))).toEqual(
      settings("claude-opus-5-5", null),
    );
  });

  test("leaves everything alone when there is nothing to choose from", () => {
    const current = settings("sonnet", "low");
    expect(reconcileModel([], current)).toBe(current);
  });
});
