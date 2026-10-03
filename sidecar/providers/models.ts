import type { ModelInfo as ApiModel } from "@anthropic-ai/sdk/resources/models";
import type { ModelInfo as CliModel } from "@anthropic-ai/claude-agent-sdk";

import type { Effort, ModelOption } from "../../shared/domain.ts";

/**
 * Which models each provider offers, and what each accepts for thinking and
 * effort so both providers ask for the same thing. With no effort chosen the
 * partner's turns want speed and the analysis a little reasoning.
 */

export interface ModelKnobs {
  /** `false` turns thinking off; `null` leaves the model's default. */
  thinking: false | null;
  effort: Effort | null;
}

type Purpose = "chat" | "structured";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Ids arrive as Claude Code aliases (`sonnet`, `claude-fable-5-1[1m]`) or API
 * ids (`claude-sonnet-5-5`), so the family is read from the name.
 */
function family(model: string): "haiku" | "thinking" | null {
  if (/haiku/iu.test(model)) {
    return "haiku";
  }
  return /sonnet|opus|fable/iu.test(model) ? "thinking" : null;
}

export function modelKnobs(
  model: string,
  purpose: Purpose,
  chosen: Effort | null,
): ModelKnobs {
  const kind = family(model);
  // Haiku rejects `effort`. Claude Code turns its thinking on, and a
  // three-turn analysis spent 12k tokens thinking (measured), so it is off.
  if (kind === "haiku") {
    return { thinking: false, effort: null };
  }
  // A chosen effort is the learner's call: the model may think to match it.
  if (chosen !== null) {
    return { thinking: null, effort: chosen };
  }
  // Sonnet 5.5, Opus 5.5 and Fable refuse thinking off (a 400 on the API),
  // so low effort is the lever for a quick partner.
  return kind === "thinking"
    ? { thinking: null, effort: purpose === "chat" ? "low" : "medium" }
    : { thinking: null, effort: null };
}

/**
 * Claude Code's own list, minus its `default` row (another name for one of
 * the others) and any second alias of a model already listed.
 */
export function claudeCodeModels(models: CliModel[]): ModelOption[] {
  const seen: Set<string> = new Set();
  return models.flatMap((model) => {
    const resolved = model.resolvedModel ?? model.value;
    if (model.value === "default" || seen.has(resolved)) {
      return [];
    }
    seen.add(resolved);
    return [
      {
        id: model.value,
        name: model.displayName,
        description: model.description === "" ? null : model.description,
        efforts:
          model.supportsEffort === true
            ? EFFORTS.filter(
                (level) =>
                  model.supportedEffortLevels?.includes(level) === true,
              )
            : [],
      },
    ];
  });
}

/**
 * The API's list, newest first as it comes. Every analysis is a JSON
 * document, so a model known to lack structured output is left out; one
 * whose capabilities are unknown stays, without an effort setting.
 */
export function apiModels(models: ApiModel[]): ModelOption[] {
  return models.flatMap((model) => {
    const capabilities = model.capabilities;
    if (capabilities?.structured_outputs.supported === false) {
      return [];
    }
    const effort = capabilities?.effort;
    return [
      {
        id: model.id,
        name: model.display_name,
        description: null,
        efforts:
          effort?.supported === true
            ? EFFORTS.filter((level) => effort[level]?.supported === true)
            : [],
      },
    ];
  });
}
