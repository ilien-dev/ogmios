/**
 * The mock's daily recall: `src-tauri/src/commands/recall.rs` in small. The
 * words finished on the shelf are due until one is answered right; a run
 * asks the words of its effort, as many as it was started for, each once,
 * and a word missed in it is due again for the next run: the mock has no
 * tomorrow. Its shelf comes with a history: of the words in shelf order,
 * every third from the first was missed three times in its chapter and
 * every third from the second once, so each effort has words. A right answer takes the word a step
 * up and a miss one down, Nothing here reopens a word in its
 * chapter.
 */
import type {
  BookWord,
  Direction,
  Recall,
  RecallAnswer,
  RecallState,
  RecallStep,
  Strength,
  SessionSize,
  Ways,
  WordHint,
} from "@shared/domain";
import type { BookReviews } from "@shared/board";
import type { RecallOptions, RecallPlan, WordEffort } from "@shared/recall";
import { mockBookId } from "./ipcMockBooks";
import { mockLearnedChapters, mockLearnedWords } from "./ipcMockChapters";
import {
  PLAIN,
  PracticeError,
  hintOf,
  isRight,
  itemOf,
  small,
} from "./ipcMockPractice";
import {
  addMockWordMiss,
  mockWordMisses,
  mockWordStep,
  mockWordStrength,
  setMockWordStep,
} from "./ipcMockWords";

/** The sizes a run is offered in, as a chapter's sessions are. */
const SIZES = [10, 20, 40];

interface Run {
  ways: Ways;
  effort: WordEffort | null;
  /** Words it asks at most; null for every one due. */
  size: number | null;
  right: number;
  missed: number;
  /** The words it has asked: it asks none twice. */
  asked: Set<string>;
}

let runs: Map<string, Run> = new Map();
/** The words answered right: they are not due again. */
let held: Set<string> = new Set();
/** The way each word was last asked. */
let sides: Map<string, Direction> = new Map();

/** Forgets every run, and every answer. */
export function resetMockRecall(): void {
  runs = new Map();
  held = new Set();
  sides = new Map();
}

/** The learned words the learner has not said they know. */
function learned(): BookWord[] {
  return mockLearnedWords().filter((word) => !word.known);
}

/** The learned words that are due, in the shelf's order. */
function due(): BookWord[] {
  return learned().filter((word) => !held.has(word.lemma));
}

/** Every miss of a word: those of its shelf's history and the recall's. */
function misses(word: BookWord): number {
  const at = learned().findIndex((each) => each.lemma === word.lemma);
  const history = [3, 1, 0][at % 3] ?? 0;
  return history + mockWordMisses(word.lemma);
}

/** How much a word cost: `memory::recall::effort`. */
function effortOf(word: BookWord): WordEffort {
  const count = misses(word);
  if (count >= 3) {
    return "hard";
  }
  return count > 0 ? "mid" : "easy";
}

/** Whether a run asks a word of this effort. */
function ofEffort(word: BookWord, run: Run): boolean {
  return run.effort === null || effortOf(word) === run.effort;
}

/** The due words a run has yet to ask: those of its effort. */
function left(run: Run): BookWord[] {
  return due().filter(
    (word) => !run.asked.has(word.lemma) && ofEffort(word, run),
  );
}

/** Seconds an answer of the review takes at the default pace. */
const SECONDS_PER_ANSWER = 8;

/**
 * How many due words are of a book, each in the chapter it was first
 * finished in, and about how many minutes they take: one answer each.
 */
function bookDue(bookId: string): BookReviews {
  const of = mockLearnedChapters();
  const count = due().filter(
    (word) => mockBookId(of.get(word.lemma) ?? "") === bookId,
  ).length;
  const minutes =
    count === 0
      ? 0
      : Math.max(1, Math.round((count * SECONDS_PER_ANSWER) / 60));
  return { due: count, minutes };
}

/** How many learned words are due, for the home screen. */
export function mockDueWords(): number {
  return due().length;
}

/**
 * A run of both ways asks a word from the other side than the last time,
 * and one never asked by the turn of the run it is asked on.
 */
function way(word: BookWord, run: Run): Direction {
  if (run.ways !== "both") {
    return run.ways;
  }
  const last = sides.get(word.lemma);
  if (last !== undefined) {
    return last === "recognition" ? "production" : "recognition";
  }
  return (run.right + run.missed) % 2 === 0 ? "recognition" : "production";
}

function stepOf(run: Run): RecallStep {
  const rest = left(run);
  const answered = run.right + run.missed;
  const room = Math.min(
    Math.max((run.size ?? Number.POSITIVE_INFINITY) - answered, 0),
    rest.length,
  );
  const [word] = rest;
  if (word === undefined || room === 0) {
    return {
      type: "summary",
      summary: {
        right: run.right,
        missed: run.missed,
        left: due().filter((each) => ofEffort(each, run)).length,
      },
      progress: { value: answered, total: answered },
    };
  }
  return {
    type: "item",
    // In the recall a word goes by its key: it is of no chapter.
    item: { ...itemOf(word, way(word, run)), wordId: word.lemma },
    progress: { value: answered, total: answered + room },
  };
}

function state(): RecallState {
  const words = learned();
  const strong = (level: Strength): number =>
    words.filter((word) => mockWordStrength(word.lemma) === level).length;
  return {
    due: due().length,
    fresh: strong("new"),
    settling: strong("settling"),
    firm: strong("firm"),
  };
}

/** A size of `words` words, with about how long it takes. */
function sized(size: number | null, words: number): SessionSize {
  const minutes =
    words === 0
      ? 0
      : Math.max(1, Math.round((words * SECONDS_PER_ANSWER) / 60));
  return { size, words, minutes };
}

function options(): RecallOptions {
  const words = due();
  return {
    efforts: (["hard", "mid", "easy"] as const).map((effort) => {
      const count = words.filter((word) => effortOf(word) === effort).length;
      return {
        effort,
        due: count,
        sizes: [
          ...SIZES.filter((size) => count > size).map((size) =>
            sized(size, size),
          ),
          sized(null, count),
        ],
      };
    }),
    all: sized(null, words.length),
  };
}

function start(plan: RecallPlan): Recall {
  const id = `recall-${String(runs.size + 1)}`;
  const run = { ...plan, right: 0, missed: 0, asked: new Set<string>() };
  runs.set(id, run);
  return { id, step: stepOf(run) };
}

/** The word a run is asking by this key, and the run. */
function asked(sittingId: string, key: string): [Run, BookWord] {
  const run = runs.get(sittingId);
  if (run === undefined) {
    throw new PracticeError("notFound", "recall not found");
  }
  const word = left(run).find((candidate) => candidate.lemma === key);
  if (word === undefined) {
    throw new PracticeError("invalid", "this word is not being asked");
  }
  return [run, word];
}

/** The hint to a word a run is asking. */
function hint(sittingId: string, key: string, letters: number): WordHint {
  const [run, word] = asked(sittingId, key);
  return hintOf(word, way(word, run), letters);
}

/**
 * An empty answer is "I don't know": a miss like any other. A right one
 * given after a hint is a helped one.
 */
function answer(
  sittingId: string,
  key: string,
  text: string,
  hinted = false,
): RecallAnswer {
  const [run, word] = asked(sittingId, key);
  const direction = way(word, run);
  const correct = isRight(word, direction, text);
  const step = mockWordStep(key);
  run.asked.add(key);
  sides.set(key, direction);
  if (correct) {
    held.add(key);
    run.right += 1;
    setMockWordStep(key, step + 1);
  } else {
    run.missed += 1;
    addMockWordMiss(key);
    setMockWordStep(key, Math.max(step - 1, 0));
  }
  return {
    correct,
    accepted: small(
      direction === "recognition" ? word.translations : [word.lemma],
    ),
    step: stepOf(run),
    answerId: run.right + run.missed,
    ...PLAIN,
    helped: correct && hinted,
  };
}

function arg(args: unknown, key: string): string {
  return String((args as Record<string, unknown>)[key]);
}

type After = <T>(ms: number, value: () => T) => Promise<T>;

export function recallCommands(
  after: After,
): Record<string, (args: unknown) => Promise<unknown>> {
  return {
    recall_state: () => after(120, state),
    book_due: (args) => after(100, () => bookDue(arg(args, "bookId"))),
    recall_options: () => after(100, options),
    start_recall: (args) =>
      after(150, () => start((args as { plan: RecallPlan }).plan)),
    answer_recall: (args) =>
      after(80, () =>
        answer(
          arg(args, "sittingId"),
          arg(args, "wordId"),
          arg(args, "answer"),
          (args as { tries?: { hinted?: boolean } }).tries?.hinted === true,
        ),
      ),
    hint_recall: (args) =>
      after(60, () =>
        hint(
          arg(args, "sittingId"),
          arg(args, "wordId"),
          Number(arg(args, "asked")),
        ),
      ),
  };
}
