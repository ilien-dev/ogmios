/**
 * What each model accepts for thinking and effort, so both providers ask for
 * the same thing. The partner's turns want speed; the analysis wants a little
 * reasoning. Unknown ids get no knob at all rather than a 400.
 */
export type Effort = "low" | "medium";

export interface ModelKnobs {
  /** `false` turns thinking off; `null` leaves the model's default. */
  thinking: false | null;
  effort: Effort | null;
}

type Purpose = "chat" | "structured";

export function modelKnobs(model: string, purpose: Purpose): ModelKnobs {
  switch (model) {
    // Sonnet 5 accepts thinking off, which is the fastest chat it can give.
    case "claude-sonnet-5":
      return purpose === "chat"
        ? { thinking: false, effort: "low" }
        : { thinking: null, effort: "medium" };
    // These two refuse thinking off at any effort; low effort is the lever.
    case "claude-opus-5-5":
    case "claude-fable-5-1":
      return { thinking: null, effort: purpose === "chat" ? "low" : "medium" };
    // Haiku 4.5 rejects `effort`. Claude Code turns its thinking on, and a
    // three-turn analysis spent 12k tokens thinking (measured), so it is off.
    case "claude-haiku-4-5-20251001":
      return { thinking: false, effort: null };
    default:
      return { thinking: null, effort: null };
  }
}
