import { describe, expect, test } from "bun:test";
import type { AnswerResult, DisputeResult, PracticeStep } from "@shared/domain";
import {
  advanced,
  answered,
  began,
  disputed,
  settled,
  showsReason,
} from "./sittingRun";
import type { Running } from "./sittingRun";

/** How far the sitting is while it runs, in these tests: 3 steps of 8. */
const SO_FAR = { value: 3, total: 8 };
const FULL = { value: 8, total: 8 };

function item(
  wordId: string,
  direction: "recognition" | "production" = "recognition",
  progress = SO_FAR,
): PracticeStep {
  return {
    type: "item",
    item: {
      wordId,
      direction,
      prompt: wordId,
      partOfSpeech: null,
      context: null,
      sentenceId: null,
    },
    progress,
  };
}

const SUMMARY: PracticeStep = {
  type: "summary",
  summary: { done: 0, open: 1 },
  progress: FULL,
};

function miss(answerId: number, step: PracticeStep): AnswerResult {
  return {
    answerId,
    correct: false,
    accepted: ["x"],
    step,
    again: false,
    another: null,
    helped: false,
    exact: null,
    sentence: null,
  };
}

function verdict(upheld: boolean, step: PracticeStep): DisputeResult {
  return { upheld, reason: upheld ? "Vale." : "Es otro sentido.", step };
}

/** A sitting on word "a", missed as answer 1 and disputed. */
function disputing(next: PracticeStep): Running {
  const start = began({ id: "s", step: item("a") });
  return disputed(answered(start, miss(1, next)), 1);
}

const ABOUT = { answerId: 1, wordId: "a" };

describe("a verdict on the word still on the screen", () => {
  test("is shown on it, and an upheld one says what comes next", () => {
    const held = disputing(item("a"));
    expect(held.disputes[1]).toEqual({ status: "pending" });

    // The word was alone and came back; upheld, it is finished instead.
    const upheld = settled(held, ABOUT, verdict(true, SUMMARY));
    expect(upheld.disputes[1]).toEqual({ status: "upheld" });
    expect(upheld.earlier).toBeNull();
    expect(upheld.step).toEqual(item("a"));
    expect(advanced(upheld, item("a")).step).toEqual(SUMMARY);

    const rejected = settled(held, ABOUT, verdict(false, item("b")));
    expect(rejected.disputes[1]).toEqual({
      status: "rejected",
      reason: "Es otro sentido.",
    });
    expect(advanced(rejected, item("a")).step).toEqual(item("a"));

    const failed = settled(held, ABOUT, null);
    expect(failed.disputes[1]).toEqual({ status: "failed" });
    expect(advanced(failed, item("a")).step).toEqual(item("a"));
  });
});

describe("a verdict that arrives after the learner went on", () => {
  test("leaves a word being answered alone and is noted for one more turn", () => {
    const typing = advanced(disputing(item("b")), item("b"));
    const after = settled(typing, ABOUT, verdict(true, item("b")));
    expect(after.step).toEqual(item("b"));
    expect(after.turn).toBe(typing.turn);
    expect(after.earlier).toEqual({
      wordId: "a",
      state: { status: "upheld" },
      turn: 1,
    });
    // Another word, even when Rust would now ask something else first.
    const other = settled(
      typing,
      ABOUT,
      verdict(true, item("a", "production")),
    );
    expect(other.step).toEqual(item("b"));
    expect(other.turn).toBe(typing.turn);

    // The miss undone is a step on the bar, whatever word is on the screen.
    const ahead = { value: 4, total: 8 };
    const raised = settled(
      typing,
      ABOUT,
      verdict(true, item("c", "recognition", ahead)),
    );
    expect(raised.step).toEqual(item("b", "recognition", ahead));
    // A rejected one undid nothing: the bar stays.
    const stands = settled(
      typing,
      ABOUT,
      verdict(false, item("c", "recognition", ahead)),
    );
    expect(stands.step).toEqual(item("b"));

    const onward = advanced(answered(after, miss(2, item("c"))), item("c"));
    expect(onward.earlier).not.toBeNull();
    expect(advanced(onward, item("d")).earlier).toBeNull();
  });

  test("replaces what comes after a word already answered", () => {
    const typing = advanced(disputing(item("b")), item("b"));
    const checked = answered(typing, miss(2, item("a")));
    const after = settled(checked, ABOUT, verdict(true, item("c")));
    expect(after.step).toEqual(item("b"));
    expect(after.disputes[2]).toBeUndefined();
    expect(advanced(after, item("a")).step).toEqual(item("c"));
    // A rejected one leaves it.
    const stands = settled(checked, ABOUT, verdict(false, item("c")));
    expect(advanced(stands, item("a")).step).toEqual(item("a"));
  });

  test("takes the disputed word off the screen when it is no longer asked", () => {
    // Alone, the missed word is shown again while Claude is asked.
    const again = advanced(disputing(item("a")), item("a"));
    const finished = settled(again, ABOUT, verdict(true, SUMMARY));
    expect(finished.step).toEqual(SUMMARY);
    expect(finished.turn).toBe(again.turn + 1);
    expect(finished.earlier?.turn).toBe(finished.turn);

    // Still asked the same way: it stays, with what was typed.
    const same = settled(again, ABOUT, verdict(true, item("a")));
    expect(same.step).toEqual(item("a"));
    expect(same.turn).toBe(again.turn);
    // Rejected or failed: nothing changed, so nothing moves.
    expect(settled(again, ABOUT, verdict(false, SUMMARY)).turn).toBe(
      again.turn,
    );
    expect(settled(again, ABOUT, null).step).toEqual(item("a"));
  });

  test("brings a summary up to date", () => {
    const over = advanced(disputing(SUMMARY), SUMMARY);
    const fresh: PracticeStep = {
      type: "summary",
      summary: { done: 1, open: 0 },
      progress: FULL,
    };
    const after = settled(over, ABOUT, verdict(true, fresh));
    expect(after.step).toEqual(fresh);
    expect(after.earlier?.state).toEqual({ status: "upheld" });
    expect(settled(over, ABOUT, verdict(true, item("b"))).step).toEqual(
      SUMMARY,
    );
  });
});

describe("a verdict on an answer of the sitting before this one", () => {
  // "Continue" began sitting "t"; answer 1 was given to "a" in sitting "s",
  // which has ended since: the step its verdict carries is that summary.
  const next = began({ id: "t", step: item("a", "production") });
  const old = verdict(true, SUMMARY);

  test("moves this sitting by its own step, not by the one it carries", () => {
    // The disputed word is on the screen and is finished now: it gives way.
    const moved = settled(next, ABOUT, old, item("b"));
    expect(moved.step).toEqual(item("b"));
    expect(moved.turn).toBe(next.turn + 1);
    expect(moved.earlier?.state).toEqual({ status: "upheld" });

    // Still asked: it stays, and the old sitting's summary is not shown.
    const same = settled(next, ABOUT, old, item("a", "production"));
    expect(same.step).toEqual(next.step);
    expect(same.earlier?.state).toEqual({ status: "upheld" });

    // Answered already: what comes after it is this sitting's.
    const checked = answered(next, miss(2, item("a", "production")));
    const after = settled(checked, ABOUT, old, item("c"));
    expect(advanced(after, item("a", "production")).step).toEqual(item("c"));
  });

  test("is told without moving anything when the step cannot be read", () => {
    const told = settled(next, ABOUT, old, null);
    expect(told.step).toEqual(next.step);
    expect(told.turn).toBe(next.turn);
    expect(told.earlier?.state).toEqual({ status: "upheld" });
    const checked = answered(next, miss(2, item("b")));
    expect(
      advanced(settled(checked, ABOUT, old, null), item("b")).step,
    ).toEqual(item("b"));
  });
});

describe("the reason of a rejected dispute", () => {
  test("is kept from the same word asked again: it may name the answer", () => {
    const earlier = {
      wordId: "a",
      state: { status: "rejected", reason: "No." } as const,
      turn: 1,
    };
    expect(showsReason(earlier, item("b"))).toBe(true);
    expect(showsReason(earlier, SUMMARY)).toBe(true);
    expect(showsReason(earlier, item("a", "production"))).toBe(false);
  });
});
