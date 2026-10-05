import type { z } from "zod";

import type {
  AnalyzeParams,
  AttemptSummaryParams,
  ChapterBriefParams,
  ChatContext,
  ChatParams,
  ChatResult,
  CheckResult,
  ComposeParams,
  DrillGenerateParams,
  DrillGradeParams,
  HelpParams,
  ModelsResult,
  ParagraphReviewParams,
  ParagraphVersionParams,
  SelfCheckParams,
  SentenceReviewParams,
  SentenceWriteParams,
  StructureDetectParams,
  StructureGradeParams,
  VocabExtractParams,
  VocabJudgeParams,
  VocabLabelParams,
} from "../../shared/protocol.ts";

/** The calls whose answer is a JSON document rather than prose. */
export type StructuredRequest =
  | { method: "help"; params: HelpParams }
  | { method: "analyze"; params: AnalyzeParams }
  | { method: "compose"; params: ComposeParams }
  | { method: "selfCheck"; params: SelfCheckParams }
  | { method: "drillGenerate"; params: DrillGenerateParams }
  | { method: "drillGrade"; params: DrillGradeParams }
  | { method: "vocabExtract"; params: VocabExtractParams }
  | { method: "vocabJudge"; params: VocabJudgeParams }
  | { method: "vocabLabel"; params: VocabLabelParams }
  | { method: "sentenceWrite"; params: SentenceWriteParams }
  | { method: "sentenceReview"; params: SentenceReviewParams }
  | { method: "chapterBrief"; params: ChapterBriefParams }
  | { method: "paragraphVersion"; params: ParagraphVersionParams }
  | { method: "paragraphReview"; params: ParagraphReviewParams }
  | { method: "attemptSummary"; params: AttemptSummaryParams }
  | { method: "structureGrade"; params: StructureGradeParams }
  | { method: "structureDetect"; params: StructureDetectParams };

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

/** A reply as the model wrote it: any starters are still inside `text`. */
export type ChatReply = Omit<ChatResult, "starters">;

/** One way of reaching Claude (SPEC §13). */
export interface Provider {
  check: () => Promise<CheckResult>;
  /** What this provider can be asked to use, as it describes it. */
  models: () => Promise<ModelsResult>;
  chat: (task: ChatTask, onDelta: DeltaSink) => Promise<ChatReply>;
  structured: <T>(task: StructuredTask<T>) => Promise<T>;
}
