import { describe, expect, test } from "bun:test";
import type {
  AnswerResult,
  PenaltyAnswer,
  PenaltyStep,
  PracticeStep,
  Sitting,
} from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { orderOf, repsOf } from "./ipcMockPenalty";
import { practiceCommands } from "./ipcMockPractice";

const CHAPTER = "book-alice-0";

const commands = practiceCommands((_, value) => Promise.resolve(value()));

async function call<T>(name: string, args: unknown): Promise<T> {
  const command = commands[name];
  if (command === undefined) {
    throw new Error(`no command ${name}`);
  }
  return (await command(args)) as T;
}

function penaltyOf(step: PracticeStep): PenaltyStep {
  if (step.type !== "penalty") {
    throw new Error(`no penalty: ${step.type}`);
  }
  return step.penalty;
}

/** The right answer to "rabbit hole", whichever way it is asked. */
function right(penalty: PenaltyStep): string {
  return penalty.item.direction === "recognition"
    ? "madriguera"
    : "rabbit hole";
}

/** A sitting whose first word is missed three times: the step after. */
async function threeMisses(): Promise<[sittingId: string, PracticeStep]> {
  const sitting = await call<Sitting>("start_sitting", { chapterId: CHAPTER });
  if (sitting.step.type !== "item") {
    throw new Error("the chapter has words to ask");
  }
  const { wordId } = sitting.step.item;
  let step: PracticeStep = sitting.step;
  for (let count = 0; count < 3; count += 1) {
    const result = await call<AnswerResult>("answer_word", {
      sittingId: sitting.id,
      wordId,
      direction: "recognition",
      answer: "",
    });
    step = result.step;
  }
  return [sitting.id, step];
}

function give(
  sittingId: string,
  penalty: PenaltyStep,
  answer: string,
): Promise<PenaltyAnswer> {
  return call("answer_penalty", {
    sittingId,
    wordId: penalty.item.wordId,
    direction: penalty.item.direction,
    answer,
  });
}

describe("the mock's penalty order", () => {
  test("has as many each way, never alternates and is the same for a key", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const order = orderOf(String(seed), 3);
      expect(order.filter((way) => way === "recognition")).toHaveLength(3);
      expect(order.every((way, at) => at === 0 || way !== order[at - 1])).toBe(
        false,
      );
    }
    expect(orderOf("a", 6)).toEqual(orderOf("a", 6));
  });

  test("asks twice as many each rung, up to 24", () => {
    expect([1, 2, 3, 4, 5].map(repsOf)).toEqual([3, 6, 12, 24, 24]);
  });
});

describe("the mock's penalty review", () => {
  useMockBackend();

  test("three misses in a row make the word's penalty the next step", async () => {
    const [, step] = await threeMisses();
    const penalty = penaltyOf(step);
    expect(penalty.english).toBe("rabbit hole");
    expect([penalty.rung, penalty.reps]).toEqual([1, 3]);
    expect(penalty.answered).toEqual([]);
  });

  test("answered right six times it is through, and practice goes on", async () => {
    const [sittingId, first] = await threeMisses();
    let step = first;
    let result: PenaltyAnswer | null = null;
    for (let count = 0; count < 6; count += 1) {
      const penalty = penaltyOf(step);
      expect(penalty.answered).toHaveLength(count);
      result = await give(sittingId, penalty, right(penalty));
      step = result.step;
    }
    expect(result?.finished).toBe(true);
    expect(step.type).toBe("item");
  });

  test("a miss starts it over, and nothing else is asked meanwhile", async () => {
    const [sittingId, first] = await threeMisses();
    const penalty = penaltyOf(first);
    const once = await give(sittingId, penalty, right(penalty));
    const missed = await give(sittingId, penaltyOf(once.step), "");
    expect(missed.restarted).toBe(true);
    expect(penaltyOf(missed.step).answered).toEqual([]);
    await expect(
      call("answer_word", {
        sittingId,
        wordId: penalty.item.wordId,
        direction: "recognition",
        answer: "madriguera",
      }),
    ).rejects.toThrow("penalty");
  });
});
