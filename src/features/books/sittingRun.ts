/**
 * Where a running sitting stands on the screen, and how "I was right" moves
 * it. A verdict takes seconds and the sitting does not wait for it, so it can
 * arrive on the word it is about, on a later one, on the summary, or in the
 * sitting after it; these functions say what each case shows. Nothing here
 * decides what a verdict changes in the learner's progress: Rust did, before
 * answering.
 */
import type {
  AnswerResult,
  DisputeResult,
  PracticeItem,
  PracticeStep,
  Sitting,
} from "@shared/domain";

/** How "I was right" on one answer is going. */
export type DisputeState =
  | { status: "pending" }
  | { status: "upheld" }
  | { status: "rejected"; reason: string }
  | { status: "failed" };

/** A verdict that arrived after the learner had left its word. */
export interface EarlierVerdict {
  /** The word the disputed answer was given to. */
  wordId: string;
  state: DisputeState;
  /** The turn it arrived in: it is shown until the turn after it ends. */
  turn: number;
}

export interface Running {
  sittingId: string;
  step: PracticeStep;
  /** How many words this sitting has shown: each one is a fresh form. */
  turn: number;
  /** The verdict on the word on the screen, once it has been answered. */
  answered: AnswerResult | null;
  /**
   * What comes next, when an upheld dispute changed it after the word on
   * the screen was answered: it replaces the step that answer came with.
   */
  next: PracticeStep | null;
  /** Every "I was right" of this sitting, by the answer it is about. */
  disputes: Record<number, DisputeState>;
  earlier: EarlierVerdict | null;
}

/** The answer a dispute is about, and the word it was given to. */
export interface Disputed {
  answerId: number;
  wordId: string;
}

export function began(sitting: Sitting): Running {
  return {
    sittingId: sitting.id,
    step: sitting.step,
    turn: 0,
    answered: null,
    next: null,
    disputes: {},
    earlier: null,
  };
}

/** The word on the screen has its verdict. */
export function answered(held: Running, result: AnswerResult): Running {
  return { ...held, answered: result };
}

/** "I was right" was pressed on an answer: Claude is being asked. */
export function disputed(held: Running, answerId: number): Running {
  return {
    ...held,
    disputes: { ...held.disputes, [answerId]: { status: "pending" } },
  };
}

/** The sitting goes on to `step`, or to what an upheld dispute made of it. */
export function advanced(held: Running, step: PracticeStep): Running {
  const { earlier } = held;
  return {
    ...held,
    step: held.next ?? step,
    turn: held.turn + 1,
    answered: null,
    next: null,
    // A verdict on an earlier word has been on the screen for a whole turn.
    earlier: earlier !== null && earlier.turn < held.turn ? null : earlier,
  };
}

/** Whether the step asks this very word, this very way. */
function sameItem(step: PracticeStep, item: PracticeItem): boolean {
  return (
    step.type === "item" &&
    step.item.wordId === item.wordId &&
    step.item.direction === item.direction
  );
}

function stateOf(outcome: DisputeResult | null): DisputeState {
  if (outcome === null) {
    return { status: "failed" };
  }
  return outcome.upheld
    ? { status: "upheld" }
    : { status: "rejected", reason: outcome.reason };
}

/**
 * A verdict arrived, or the request failed (`outcome` is null) and the miss
 * stands. Only an upheld one changes what the sitting shows:
 *
 * - on a word already answered, what comes after it is what Rust says now;
 * - on a summary, the summary is the one Rust gives now;
 * - on the disputed word itself, shown again and not answered yet, the word
 *   gives way if it is no longer asked: answering it would be refused.
 *
 * A word that is being answered and is not the disputed one stays as it is,
 * but for how far it says the sitting is: the miss undone is a step back on
 * the bar, whatever word is on the screen.
 *
 * "What Rust says now" is the verdict's own step while the sitting on the
 * screen is the one the answer was given in. After "Continue" it is not:
 * `now` is then this sitting's step read again, or null when it could not be
 * read, and the verdict is told without moving anything.
 */
export function settled(
  held: Running,
  { answerId, wordId }: Disputed,
  outcome: DisputeResult | null,
  now?: PracticeStep | null,
): Running {
  const state = stateOf(outcome);
  const judged = { ...held, disputes: { ...held.disputes, [answerId]: state } };
  const told = now === undefined ? (outcome?.step ?? null) : now;
  const fresh = outcome?.upheld === true ? told : null;
  if (held.answered?.answerId === answerId) {
    return { ...judged, next: fresh ?? held.next };
  }
  const earlier = { wordId, state, turn: held.turn };
  if (held.answered !== null) {
    return { ...judged, earlier, next: fresh ?? held.next };
  }
  if (fresh === null) {
    return { ...judged, earlier };
  }
  if (held.step.type === "summary") {
    return fresh.type === "summary"
      ? { ...judged, earlier, step: fresh }
      : { ...judged, earlier };
  }
  if (held.step.item.wordId !== wordId || sameItem(fresh, held.step.item)) {
    const step = { ...held.step, progress: fresh.progress };
    return { ...judged, earlier, step };
  }
  const turn = held.turn + 1;
  return { ...judged, earlier: { ...earlier, turn }, step: fresh, turn };
}

/**
 * Whether a rejected dispute's reason can be shown beside the word on the
 * screen. The reason is about the disputed word and may name it, which
 * would answer that same word asked again.
 */
export function showsReason(
  earlier: EarlierVerdict,
  step: PracticeStep,
): boolean {
  return step.type === "summary" || step.item.wordId !== earlier.wordId;
}
