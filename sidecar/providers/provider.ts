import type { z } from "zod";

import type {
  AnalyzeParams,
  ChatContext,
  ChatParams,
  ChatResult,
  CheckResult,
  ComposeParams,
  DrillGenerateParams,
  DrillGradeParams,
  HelpParams,
  SelfCheckParams,
} from "../../shared/protocol.ts";

/** The calls whose answer is a JSON document rather than prose. */
export type StructuredRequest =
  | { method: "help"; params: HelpParams }
  | { method: "analyze"; params: AnalyzeParams }
  | { method: "compose"; params: ComposeParams }
  | { method: "selfCheck"; params: SelfCheckParams }
  | { method: "drillGenerate"; params: DrillGenerateParams }
  | { method: "drillGrade"; params: DrillGradeParams };

/**
 * One structured call, fully rendered: a real provider only transports
 * `system` and `user`; the fake one answers from `request`.
 */
export interface StructuredTask<T> {
  request: StructuredRequest;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Output ceiling; analysis of a long session needs far more than a hint. */
  maxTokens: number;
}

export interface ChatTask {
  context: ChatContext;
  system: string;
  history: ChatParams["history"];
  providerRef: string | null;
  /** Sent in place of a learner turn when the partner speaks first. */
  kickoff: string;
}

export type DeltaSink = (text: string) => void;

/** One way of reaching Claude (SPEC §13). */
export interface Provider {
  check: () => Promise<CheckResult>;
  chat: (task: ChatTask, onDelta: DeltaSink) => Promise<ChatResult>;
  structured: <T>(task: StructuredTask<T>) => Promise<T>;
}
