/**
 * The mock's daily recall: `src-tauri/src/commands/recall.rs` in small. The
 * words finished on the shelf are due until one is answered right; a run
 * asks ten at most, each once, and a word missed in it is due again for the
 * next run: the mock has no tomorrow. A right answer takes the word a step
 * up and a miss one down, and three misses make it one that keeps slipping,
 * which carries the learner's note. Nothing here reopens a word in its
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
  Ways,
  WordHint,
} from "@shared/domain";
import { mockLearnedWords } from "./ipcMockChapters";
import {
  PLAIN,
  PracticeError,
  hintOf,
  isRight,
  itemOf,
} from "./ipcMockPractice";
import {
  addMockWordMiss,
  mockWordMisses,
  mockWordStep,
  mockWordStrength,
  setMockWordStep,
} from "./ipcMockWords";

/** Words a run asks at most. */
const SIZE = 10;
/** Misses that make a word one that keeps slipping. */
const STUBBORN_MISSES = 3;

interface Run {
  ways: Ways;
  right: number;
  missed: number;
  /** The words it has asked: it asks none twice. */
  asked: Set<string>;
}

let runs: Map<string, Run> = new Map();
/** The words answered right: they are not due again. */
let held: Set<string> = new Set();
let notes: Map<string, string> = new Map();

/** Forgets every run, every answer and every note. */
export function resetMockRecall(): void {
  runs = new Map();
  held = new Set();
  notes = new Map();
}

/** The learned words the learner has not said they know. */
function learned(): BookWord[] {
  return mockLearnedWords().filter((word) => !word.known);
}

/** The learned words that are due, in the shelf's order. */
function due(): BookWord[] {
  return learned().filter((word) => !held.has(word.lemma));
}

/** The due words a run has yet to ask. */
function left(run: Run): BookWord[] {
  return due().filter((word) => !run.asked.has(word.lemma));
}

/** How many learned words are due, for the home screen. */
export function mockDueWords(): number {
  return due().length;
}

/** A run of both ways asks a word by turns, by the step it is on. */
function way(word: BookWord, ways: Ways): Direction {
  if (ways !== "both") {
    return ways;
  }
  return mockWordStep(word.lemma) % 2 === 0 ? "recognition" : "production";
}

function stepOf(run: Run): RecallStep {
  const rest = left(run);
  const answered = run.right + run.missed;
  const room = Math.min(Math.max(SIZE - answered, 0), rest.length);
  const [word] = rest;
  if (word === undefined || room === 0) {
    return {
      type: "summary",
      summary: { right: run.right, missed: run.missed, left: due().length },
      progress: { value: answered, total: answered },
    };
  }
  return {
    type: "item",
    // In the recall a word goes by its key: it is of no chapter.
    item: { ...itemOf(word, way(word, run.ways)), wordId: word.lemma },
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

function start(ways: Ways): Recall {
  const id = `recall-${String(runs.size + 1)}`;
  const run = { ways, right: 0, missed: 0, asked: new Set<string>() };
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
  return hintOf(word, way(word, run.ways), letters);
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
  const direction = way(word, run.ways);
  const correct = isRight(word, direction, text);
  const step = mockWordStep(key);
  run.asked.add(key);
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
    accepted:
      direction === "recognition" ? [...word.translations] : [word.lemma],
    step: stepOf(run),
    stubborn: mockWordMisses(key) >= STUBBORN_MISSES,
    note: notes.get(key) ?? null,
    answerId: run.right + run.missed,
    ...PLAIN,
    helped: correct && hinted,
  };
}

function saveNote(key: string, note: string): null {
  const text = note.trim();
  if (text === "") {
    notes.delete(key);
  } else {
    notes.set(key, text);
  }
  return null;
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
    start_recall: (args) => after(150, () => start(arg(args, "ways") as Ways)),
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
    save_word_note: (args) =>
      after(80, () => saveNote(arg(args, "wordId"), arg(args, "note"))),
  };
}
