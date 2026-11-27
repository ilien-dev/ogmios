/**
 * What a run of the daily recall can be started with, as
 * `src-tauri/src/domain.rs` has it: kept apart from `domain.ts` only for its
 * length. The words are split by effort in `src-tauri/src/memory/recall.rs`.
 */
import type { SessionSize, Ways } from "./domain.ts";

/**
 * How much a learned word cost the learner, by every miss it ever had:
 * `hard` from three, `mid` from one, `easy` when never missed.
 */
export type WordEffort = "hard" | "mid" | "easy";

/**
 * What a run of the recall asks: in these ways, the words of one effort
 * (null for every effort), and at most `size` of them (null for every one
 * that is due).
 */
export interface RecallPlan {
  ways: Ways;
  effort: WordEffort | null;
  size: number | null;
}

/**
 * The words of one effort that are due today, and the sizes a run of them
 * is offered in: those it has more words than, then all of them.
 */
export interface EffortDue {
  effort: WordEffort;
  due: number;
  sizes: SessionSize[];
}

/**
 * What a run of the recall in some ways can be started with: the words of
 * each effort, hard first, and every word due at once.
 */
export interface RecallOptions {
  efforts: EffortDue[];
  all: SessionSize;
}
