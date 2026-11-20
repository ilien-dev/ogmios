/**
 * The mock's penalty review: the rule of `src-tauri/src/books/penalty.rs`
 * in small. A word missed three times in a row in practice, "I don't know"
 * included, is asked on its own until it is answered right 3 times each
 * way in a row, in an order drawn at random that never alternates; a miss
 * starts it over in a new order. Each new streak asks twice as many, up to
 * 24. The mock takes no rung back: there are no days in it.
 *
 * Whether one is due is read off the answers `ipcMockPractice.ts` keeps,
 * as Rust reads it off `word_answers`; a penalty's own answers are kept
 * here, never there.
 */
import type {
  BookWord,
  Direction,
  PenaltyAnswer,
  PracticeItem,
  PracticeStep,
  SittingProgress,
} from "@shared/domain";

const STREAK = 3;
const TOP = 4;

/** An answer of practice as the streak counts it. */
export interface Counted {
  wordId: string;
  correct: boolean;
  refresh?: true;
}

/** Where a word stands with its penalties. */
interface Row {
  rung: number;
  /** Answers before this place among all of them make no streak. */
  since: number;
  /** The miss the penalty under way is due for; null while none is. */
  trigger: number | null;
  position: number;
  restarts: number;
  sittingId: string | null;
}

const FRESH: Row = {
  rung: 0,
  since: 0,
  trigger: null,
  position: 0,
  restarts: 0,
  sittingId: null,
};

let rows: Map<string, Row> = new Map();

/** Forgets every penalty. */
export function resetMockPenalties(): void {
  rows = new Map();
}

/** How many a penalty on `rung` asks each way: 3, 6, 12, 24. */
export function repsOf(rung: number): number {
  return 3 * 2 ** (Math.min(Math.max(rung, 1), TOP) - 1);
}

/** A number drawn from `key`: the same key, the same number. */
function hash(key: string): number {
  let value = 2_166_136_261;
  for (const char of key) {
    value = Math.imul(value ^ (char.codePointAt(0) ?? 0), 16_777_619) >>> 0;
  }
  return value;
}

function alternates(order: readonly Direction[]): boolean {
  return order.every((way, at) => at === 0 || way !== order[at - 1]);
}

/** `reps` each way, shuffled from `key`; an order that alternates is drawn again. */
export function orderOf(key: string, reps: number): Direction[] {
  for (let draw = 0; ; draw += 1) {
    const order: Direction[] = [
      ...Array.from({ length: reps }, () => "recognition" as const),
      ...Array.from({ length: reps }, () => "production" as const),
    ];
    for (let place = order.length - 1; place > 0; place -= 1) {
      const other =
        hash(`${key}:${String(draw)}:${String(place)}`) % (place + 1);
      const held = order[place];
      const swapped = order[other];
      if (held !== undefined && swapped !== undefined) {
        order[place] = swapped;
        order[other] = held;
      }
    }
    if (!alternates(order)) {
      return order;
    }
  }
}

/** A penalty due: the word, and the miss it is due for. */
interface Due {
  wordId: string;
  trigger: number;
}

/**
 * The penalty due among `words`, read off `given`, every answer oldest
 * first: one under way before any other, then the one due longest.
 */
export function dueIn(
  words: readonly string[],
  given: readonly Counted[],
): Due | null {
  for (const wordId of words) {
    const trigger = rows.get(wordId)?.trigger ?? null;
    if (trigger !== null) {
      return { wordId, trigger };
    }
  }
  let found: Due | null = null;
  for (const wordId of words) {
    const since = rows.get(wordId)?.since ?? 0;
    let misses = 0;
    let last = -1;
    given.forEach((each, at) => {
      if (each.wordId !== wordId || each.refresh === true || at < since) {
        return;
      }
      misses = each.correct ? 0 : misses + 1;
      last = each.correct ? -1 : at;
    });
    if (misses >= STREAK && (found === null || last < found.trigger)) {
      found = { wordId, trigger: last };
    }
  }
  return found;
}

/** The row as the sitting stands with it: left halfway, it starts over. */
function rowIn(due: Due, sittingId: string): Row {
  const row = rows.get(due.wordId) ?? FRESH;
  if (row.position > 0 && row.sittingId !== sittingId) {
    const over = {
      ...row,
      position: 0,
      restarts: row.restarts + 1,
      sittingId,
    };
    rows.set(due.wordId, over);
    return over;
  }
  return row;
}

function drawn(due: Due, row: Row): { rung: number; order: Direction[] } {
  const rung = Math.min(row.rung + 1, TOP);
  const key = `${due.wordId}${String(due.trigger)}${String(row.restarts)}`;
  return { rung, order: orderOf(key, repsOf(rung)) };
}

/** How a word is asked and shown, from `ipcMockPractice.ts`. */
export interface Asking {
  word: BookWord;
  itemOf: (word: BookWord, direction: Direction) => PracticeItem;
}

/** The step a sitting shows while the penalty `due` is. */
export function penaltyStep(
  due: Due,
  sittingId: string,
  { word, itemOf }: Asking,
  progress: SittingProgress,
): PracticeStep {
  const row = rowIn(due, sittingId);
  const { rung, order } = drawn(due, row);
  const at = Math.min(row.position, order.length - 1);
  return {
    type: "penalty",
    penalty: {
      rung,
      reps: repsOf(rung),
      answered: order.slice(0, at),
      english: word.lemma.toLowerCase(),
      native: word.translations.join(", ").toLowerCase(),
      item: itemOf(word, order[at] ?? "recognition"),
    },
    progress,
  };
}

/** What a penalty answer needs: whether it is right, and what was asked. */
export interface Judging {
  correct: boolean;
  accepted: string[];
}

/**
 * One answer to the penalty `due`, asked `direction`: right, it goes one
 * on, and the last one puts the word on its rung; a miss starts it over.
 * `next` is what the sitting shows after it. Asked another way than the
 * one it asks now, it throws.
 */
export function answerPenaltyIn(
  due: Due,
  sittingId: string,
  direction: Direction,
  judging: Judging,
  next: () => PracticeStep,
): PenaltyAnswer {
  const row = rowIn(due, sittingId);
  const { rung, order } = drawn(due, row);
  if (order[row.position] !== direction) {
    throw new Error("this penalty is not being asked");
  }
  const { correct, accepted } = judging;
  const finished = correct && row.position + 1 >= order.length;
  if (finished) {
    rows.set(due.wordId, { ...FRESH, rung, since: due.trigger + 1 });
  } else {
    rows.set(due.wordId, {
      ...row,
      trigger: due.trigger,
      sittingId,
      position: correct ? row.position + 1 : 0,
      restarts: correct ? row.restarts : row.restarts + 1,
    });
  }
  return {
    correct,
    accepted,
    again: false,
    restarted: !correct,
    finished,
    step: next(),
    ladder: null,
    understood: null,
  };
}

/** What the penalties read off practice: lent once by `ipcMockPractice.ts`. */
export interface PenaltyDesk {
  /** Every answer of practice and of the refresh, oldest first. */
  given: () => readonly Counted[];
  words: (chapterId: string) => readonly BookWord[];
  itemOf: Asking["itemOf"];
  judge: (word: BookWord, direction: Direction, text: string) => Judging;
}

let desk: PenaltyDesk | null = null;

export function lendToPenalties(practice: PenaltyDesk): void {
  desk = practice;
}

function lent(): PenaltyDesk {
  if (desk === null) {
    throw new Error("the penalties have no practice to read");
  }
  return desk;
}

/** The penalty the chapter has due, and its word; null when none is. */
function dueOn(chapterId: string): [Due, BookWord] | null {
  const words = lent()
    .words(chapterId)
    .filter((word) => !word.known);
  const due = dueIn(
    words.map((word) => word.id),
    lent().given(),
  );
  const word = words.find((each) => each.id === due?.wordId);
  return due === null || word === undefined ? null : [due, word];
}

/** Whether the chapter has a penalty due: nothing else is asked. */
export function isPenaltyDue(chapterId: string): boolean {
  return dueOn(chapterId) !== null;
}

/** What a sitting of the chapter shows while a penalty is due; null if none. */
export function mockPenaltyStep(
  chapterId: string,
  sittingId: string,
  progress: SittingProgress,
): PracticeStep | null {
  const found = dueOn(chapterId);
  if (found === null) {
    return null;
  }
  const [due, word] = found;
  return penaltyStep(due, sittingId, { word, itemOf: lent().itemOf }, progress);
}

/** One answer to the penalty a sitting of the chapter is showing. */
export function answerMockPenalty(
  chapterId: string,
  sittingId: string,
  asked: { wordId: string; direction: Direction },
  text: string,
  next: () => PracticeStep,
): PenaltyAnswer {
  const found = dueOn(chapterId);
  if (found === null || found[0].wordId !== asked.wordId) {
    throw new Error("this penalty is not being asked");
  }
  const [due, word] = found;
  const judging = lent().judge(word, asked.direction, text);
  return answerPenaltyIn(due, sittingId, asked.direction, judging, next);
}
