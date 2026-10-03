import { describe, expect, test } from "bun:test";
import type {
  AnswerResult,
  Direction,
  DisputeResult,
  PracticeOptions,
  PracticeStep,
  Sitting,
} from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { mockChapterWords, seedMockLongChapter } from "./ipcMockChapters";
import { practiceCommands } from "./ipcMockPractice";

const CHAPTER = "book-alice-0";
const THERE: Direction = "recognition";
const BACK: Direction = "production";

/** The mock's sitting commands, answering at once. */
const commands = practiceCommands((_, value) => Promise.resolve(value()));

async function call<T>(name: string, args: unknown): Promise<T> {
  const command = commands[name];
  if (command === undefined) {
    throw new Error(`no command ${name}`);
  }
  // The mock answers with what Rust would: the caller names its shape.
  return (await command(args)) as T;
}

/** A sitting on the mock's prepared chapter, and its first word's id. */
async function sit(): Promise<[sittingId: string, wordId: string]> {
  const sitting = await call<Sitting>("start_sitting", { chapterId: CHAPTER });
  if (sitting.step.type !== "item") {
    throw new Error("the chapter has words to ask");
  }
  expect(sitting.step.item.prompt).toBe("rabbit hole");
  return [sitting.id, sitting.step.item.wordId];
}

function isDone(wordId: string): boolean {
  return mockChapterWords(CHAPTER).some(
    (word) => word.id === wordId && word.done,
  );
}

describe("the mock's rule for a finished word", () => {
  useMockBackend();

  test("two right answers in a row each way finish a word", async () => {
    const [sittingId, wordId] = await sit();
    const say = (direction: Direction, answer: string): Promise<AnswerResult> =>
      call("answer_word", { sittingId, wordId, direction, answer });

    // One right answer does not open the other way.
    expect((await say(THERE, "madriguera")).correct).toBe(true);
    await expect(say(BACK, "rabbit hole")).rejects.toThrow("not being asked");

    // The second in a row finishes that way: it is not asked again.
    expect((await say(THERE, "madriguera")).correct).toBe(true);
    await expect(say(THERE, "madriguera")).rejects.toThrow("not being asked");
    expect(isDone(wordId)).toBe(false);

    expect((await say(BACK, "rabbit hole")).correct).toBe(true);
    expect(isDone(wordId)).toBe(false);
    expect((await say(BACK, "rabbit hole")).correct).toBe(true);
    expect(isDone(wordId)).toBe(true);
    await expect(say(BACK, "rabbit hole")).rejects.toThrow("not being asked");
  });

  test("a miss takes the run back to none and adds nothing", async () => {
    const [sittingId, wordId] = await sit();
    const say = (direction: Direction, answer: string): Promise<AnswerResult> =>
      call("answer_word", { sittingId, wordId, direction, answer });

    // Right, miss, right is not two in a row: the other way stays closed.
    for (const text of ["madriguera", "cueva", "madriguera"]) {
      await say(THERE, text);
    }
    await expect(say(BACK, "rabbit hole")).rejects.toThrow("not being asked");

    // One more right answer is: no miss is left to pay for.
    await say(THERE, "madriguera");
    await expect(say(THERE, "madriguera")).rejects.toThrow("not being asked");

    // Miss, miss, right, right finishes the other way, and the word.
    for (const text of ["burrow hole", "", "rabbit hole"]) {
      await say(BACK, text);
      expect(isDone(wordId)).toBe(false);
    }
    await say(BACK, "rabbit hole");
    expect(isDone(wordId)).toBe(true);
  });

  test("an upheld miss after a right answer finishes that way", async () => {
    const [sittingId, wordId] = await sit();
    const say = (direction: Direction, answer: string): Promise<AnswerResult> =>
      call("answer_word", { sittingId, wordId, direction, answer });

    await say(THERE, "madriguera");
    const miss = await say(THERE, "conejera");
    expect(miss.correct).toBe(false);
    await expect(say(BACK, "rabbit hole")).rejects.toThrow("not being asked");

    await call<PracticeStep>("dispute_answer", { answerId: miss.answerId });
    await expect(say(THERE, "madriguera")).rejects.toThrow("not being asked");
    expect((await say(BACK, "rabbit hole")).correct).toBe(true);
  });
});

describe("the mock's bar", () => {
  useMockBackend();

  test("goes up a step on a right answer and down one on a miss that breaks a run", async () => {
    const [sittingId, wordId] = await sit();
    const say = async (
      direction: Direction,
      answer: string,
    ): Promise<[AnswerResult, number]> => {
      const result = await call<AnswerResult>("answer_word", {
        sittingId,
        wordId,
        direction,
        answer,
      });
      expect(result.step.progress.total).toBe(32);
      return [result, result.step.progress.value];
    };
    const now = await call<PracticeStep>("sitting_step", { sittingId });
    expect(now.progress).toEqual({ value: 0, total: 32 });

    expect((await say(THERE, "cueva"))[1]).toBe(0);
    expect((await say(THERE, "madriguera"))[1]).toBe(1);
    const [miss, lowered] = await say(THERE, "conejera");
    expect(lowered).toBe(0);
    // Upheld, the miss is a right answer: its step is back, and its own.
    const upheld = await call<DisputeResult>("dispute_answer", {
      answerId: miss.answerId,
    });
    expect(upheld.upheld).toBe(true);
    expect(upheld.step.progress).toEqual({ value: 2, total: 32 });
    expect((await say(BACK, "rabbit hole"))[1]).toBe(3);
    expect((await say(BACK, "burrow hole"))[1]).toBe(2);

    // Read again, it is where it was.
    const again = await call<PracticeStep>("sitting_step", { sittingId });
    expect(again.progress).toEqual({ value: 2, total: 32 });

    // "I know this" takes the word's steps out of both numbers.
    const known = await call<PracticeStep>("know_word", { sittingId, wordId });
    expect(known.progress).toEqual({ value: 0, total: 28 });
  });

  test("is full only on the summary", async () => {
    let { id, step } = await call<Sitting>("start_sitting", {
      chapterId: CHAPTER,
    });
    let turn = 0;
    while (step.type === "item") {
      const { wordId, direction } = step.item;
      const before = step.progress;
      expect(before.value).toBeLessThan(before.total);
      const word = mockChapterWords(CHAPTER).find((each) => each.id === wordId);
      const right =
        direction === THERE ? (word?.translations[0] ?? "") : word?.lemma;
      const wrong = turn % 4 === 1;
      const result = await call<AnswerResult>("answer_word", {
        sittingId: id,
        wordId,
        direction,
        answer: wrong ? "no" : right,
      });
      const after = result.step.progress;
      expect(after.total).toBe(32);
      if (wrong) {
        expect(before.value - after.value).toBeLessThanOrEqual(1);
        expect(after.value).toBeLessThanOrEqual(before.value);
      } else {
        expect(after.value).toBe(before.value + 1);
      }
      ({ step } = result);
      turn += 1;
    }
    expect(step.progress).toEqual({ value: 32, total: 32 });
    expect(id).toBe("sitting-1");
  });
});

describe("the mock's session", () => {
  useMockBackend();

  /** The chapter `seedMockLongChapter` prepares: twelve words. */
  const LONG = "book-alice-3";

  /** One question as it was asked, and how many words were open then. */
  interface Turn {
    wordId: string;
    open: number;
  }

  function openWords(sittingWords: ReadonlySet<string>): number {
    return mockChapterWords(LONG).filter(
      (word) => sittingWords.has(word.id) && !word.done && !word.known,
    ).length;
  }

  /**
   * Plays a session to its summary, every answer right but the ones `wrong`
   * names by their turn; a finished word is never asked again.
   */
  async function play(
    sitting: Sitting,
    words: ReadonlySet<string>,
    wrong: (turn: number) => boolean,
  ): Promise<[Turn[], PracticeStep]> {
    const turns: Turn[] = [];
    let { step } = sitting;
    while (step.type === "item") {
      const { wordId, direction } = step.item;
      const word = mockChapterWords(LONG).find((each) => each.id === wordId);
      if (word === undefined || word.done) {
        throw new Error(`${wordId} is not to be asked`);
      }
      const right =
        direction === THERE ? (word.translations[0] ?? "") : word.lemma;
      const answer = wrong(turns.length) ? "no" : right;
      turns.push({ wordId, open: openWords(words) });
      const result = await call<AnswerResult>("answer_word", {
        sittingId: sitting.id,
        wordId,
        direction,
        answer,
      });
      ({ step } = result);
    }
    return [turns, step];
  }

  test("a session of ten asks only its ten words, spaced, until they are done", async () => {
    seedMockLongChapter();
    const before = await call<PracticeOptions>("practice_options", {
      chapterId: LONG,
    });
    expect(before).toEqual({
      resume: false,
      sizes: [
        { size: 10, words: 10, minutes: 7 },
        { size: null, words: 12, minutes: 8 },
      ],
    });
    const ten = new Set(
      mockChapterWords(LONG)
        .slice(0, 10)
        .map((word) => word.id),
    );

    const sitting = await call<Sitting>("start_sitting", {
      chapterId: LONG,
      size: 10,
    });
    const [turns, end] = await play(
      sitting,
      ten,
      (turn) => turn < 60 && turn % 6 === 2,
    );
    expect(new Set(turns.map((turn) => turn.wordId))).toEqual(ten);
    expect(turns.length).toBeGreaterThan(40);
    for (const [at, turn] of turns.entries()) {
      const asked = turns.slice(0, at).map((each) => each.wordId);
      const last = asked.lastIndexOf(turn.wordId);
      const between = at - last - 1;
      if (last !== -1 && turn.open > 5) {
        expect(between).toBeGreaterThanOrEqual(5);
      }
      if (last !== -1 && turn.open > 1) {
        expect(between).toBeGreaterThan(0);
      }
    }
    expect(turns.some((turn) => turn.open === 2)).toBe(true);
    expect(end).toEqual({
      type: "summary",
      summary: { done: 10, open: 2 },
      progress: { value: 40, total: 40 },
    });

    // It is over: the next one is asked for again, and takes what is left.
    const after = await call<PracticeOptions>("practice_options", {
      chapterId: LONG,
    });
    expect(after).toEqual({
      resume: false,
      sizes: [{ size: null, words: 2, minutes: 1 }],
    });
    const next = await call<Sitting>("start_sitting", { chapterId: LONG });
    expect(next.id).not.toBe(sitting.id);
    const rest = new Set(
      mockChapterWords(LONG)
        .filter((word) => !word.done)
        .map((word) => word.id),
    );
    const [last, summary] = await play(next, rest, () => false);
    expect(new Set(last.map((turn) => turn.wordId))).toEqual(rest);
    expect(summary).toEqual({
      type: "summary",
      summary: { done: 2, open: 0 },
      progress: { value: 8, total: 8 },
    });
  });

  test("a missed question comes back after exactly five others", async () => {
    seedMockLongChapter();
    const sitting = await call<Sitting>("start_sitting", { chapterId: LONG });
    const all = new Set(mockChapterWords(LONG).map((word) => word.id));
    const [turns] = await play(sitting, all, (turn) => turn === 3);
    const asked = turns.map((turn) => turn.wordId);
    expect(asked.indexOf(asked[3] ?? "", 4)).toBe(9);
    // A right first look waits for the pass to come round.
    expect(asked.indexOf(asked[0] ?? "", 1)).toBe(13);
  });

  test("a session left halfway is gone on with, whatever size is asked for", async () => {
    seedMockLongChapter();
    const sitting = await call<Sitting>("start_sitting", {
      chapterId: LONG,
      size: 10,
    });
    let { step } = sitting;
    for (const answer of ["madriguera", "orilla", "no"]) {
      if (step.type !== "item") {
        throw new Error("the session has words to ask");
      }
      const { wordId, direction } = step.item;
      const result = await call<AnswerResult>("answer_word", {
        sittingId: sitting.id,
        wordId,
        direction,
        answer,
      });
      ({ step } = result);
    }

    const options = await call<PracticeOptions>("practice_options", {
      chapterId: LONG,
    });
    expect(options.resume).toBe(true);
    const resumed = await call<Sitting>("start_sitting", {
      chapterId: LONG,
      size: null,
    });
    expect(resumed).toEqual({ id: sitting.id, step });

    // One right answer, one more, and a miss on a word with no run: the bar
    // is where it was left.
    expect(resumed.step.progress).toEqual({ value: 2, total: 40 });

    // A chapter too short for a size offers every word and nothing else.
    const short = await call<PracticeOptions>("practice_options", {
      chapterId: CHAPTER,
    });
    expect(short).toEqual({
      resume: false,
      sizes: [{ size: null, words: 8, minutes: 5 }],
    });
  });
});
