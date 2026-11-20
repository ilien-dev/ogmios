/**
 * The penalty review of a session of practice: `PenaltyStep` and
 * `PenaltyAnswer` in `src-tauri/src/domain.rs`, kept apart from `domain.ts`
 * only for its length. The rules are `src-tauri/src/books/penalty.rs`.
 */
import type {
  Direction,
  Ladder,
  PracticeItem,
  PracticeStep,
  SenseTip,
} from "./domain.ts";

/** A penalty under way, and the question it asks now. */
export interface PenaltyStep {
  /** The rung it is asked on, 1 to 4. */
  rung: number;
  /** How many times it asks the word each way: 3, 6, 12 or 24. */
  reps: number;
  /**
   * The ways it was answered in so far, right every time, oldest first; as
   * many as it has answered.
   */
  answered: Direction[];
  /** The word in English and in the learner's language: what it is on. */
  english: string;
  native: string;
  /** The question it asks now, as its chapter has the word. */
  item: PracticeItem;
}

/** The verdict on an answer to a penalty, and what comes after it. */
export interface PenaltyAnswer {
  correct: boolean;
  /** What was asked for, the first one first. */
  accepted: string[];
  /**
   * Nothing was kept: the word in another form, or another word for what
   * was shown. The learner has one more try at it.
   */
  again: boolean;
  /** The answer was a miss: the penalty starts over, in a new order. */
  restarted: boolean;
  /**
   * That was the last one: the penalty is through, and `step` is what the
   * sitting asks next.
   */
  finished: boolean;
  step: PracticeStep;
  /** As in `AnswerResult`. */
  ladder: Ladder | null;
  understood: SenseTip | null;
}
