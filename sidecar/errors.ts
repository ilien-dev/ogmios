import type { AgentErrorKind } from "../shared/protocol.ts";

/**
 * An error whose message is fit to show the learner as it stands. Anything
 * else that reaches the dispatcher is reported as `internal`.
 */
export class AgentError extends Error {
  readonly kind: AgentErrorKind;

  constructor(kind: AgentErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentError";
    this.kind = kind;
  }
}

export function providerError(message: string, cause?: unknown): AgentError {
  return new AgentError("provider", message, { cause });
}
