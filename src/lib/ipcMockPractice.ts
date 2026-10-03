/**
 * The mock's sittings: the rule of `src-tauri/src/books/practice.rs` in
 * small. A word is asked both ways, English → native first and native →
 * English once that way has been finished. Each way is finished by two
 * correct answers in a row; a miss takes the run back to none and adds
 * nothing.
 *
 * A session has its own words: as many of the chapter's open ones as it was
 * started with, most frequent first. It asks only those, in the order
 * `ipcMockSession.ts` gives, and ends when each is done or known, however
 * long that takes. One left before that is gone on with by the next
 * "Practice", with the same words. Answers are checked for a Spanish
 * speaker, the learner the mock is seeded with.
 *
 * "I was right" has no model to ask: the mock upholds the answers of
 * `ALSO_RIGHT` and no other. Every answer is kept, so that an upheld one is
 * undone the way Rust undoes it: that answer becomes a right one. A word's
 * standing is never added to: it is read off all its answers each time, by
 * `recount`, the one place the rule is written here.
 *
 * Every step says how far its session is, as Rust's does: the right answers
 * in a row its words stand on, out of two each way for every word.
 */
import type {
  AnswerResult,
  BookWord,
  Direction,
  DisputeResult,
  PracticeItem,
  PracticeOptions,
  PracticeStep,
  SentencePart,
  Sitting,
  SittingProgress,
} from "@shared/domain";
import { mockChapterWords } from "./ipcMockChapters";
import { nextQuestion, sizesFor } from "./ipcMockSession";
import type { Asked } from "./ipcMockSession";
import { setMockWordDone, setMockWordKnown } from "./ipcMockWords";

const IN_A_ROW = 2;
const DIRECTIONS: readonly Direction[] = ["recognition", "production"];
/** What may lead an answer in the learner's language, and in English. */
const ARTICLES = new Set(["el", "la", "los", "las", "un", "una"]);
const LEADING = new Set(["to", "a", "an", "the"]);

/** The sentences of the words that are asked with their context. */
const CONTEXT: Record<string, SentencePart[]> = {
  tumble: [
    { text: "Down she ", marked: false },
    { text: "tumbled", marked: true },
    { text: ", after the Rabbit.", marked: false },
  ],
  bank: [
    { text: "Alice sat by her sister on the ", marked: false },
    { text: "bank", marked: true },
    { text: ".", marked: false },
  ],
};

/** Answers the mock's judge upholds, by the word's base form. */
const ALSO_RIGHT: Record<string, readonly string[]> = {
  "rabbit hole": ["conejera", "burrow"],
  tumble: ["caer", "fall"],
  curtsey: ["inclinarse", "bow"],
  waistcoat: ["chalequillo", "vest"],
};

/** Where a word stands. Only a word that has been answered has one. */
interface Standing {
  /** Correct answers in a row the word still owes, each way. */
  owed: Record<Direction, number>;
  /**
   * English → native has been finished at some point: the other way is
   * asked too, even if a later miss makes the first owe again.
   */
  opened: boolean;
}

/** A word nobody has answered yet. */
const FRESH: Standing = {
  owed: { recognition: IN_A_ROW, production: IN_A_ROW },
  opened: false,
};

/** One answer as it was given; its id is its place among all answers. */
interface Given {
  sittingId: string;
  wordId: string;
  direction: Direction;
  text: string;
  correct: boolean;
  /** "I was right" has had its verdict: an answer is judged once. */
  judged: boolean;
}

interface MockSitting {
  chapterId: string;
  /** The words it was started with, most frequent first. */
  words: readonly string[];
  /** It ran out of words to ask: it is over, and is not gone on with. */
  finished: boolean;
}

let sittings: Map<string, MockSitting> = new Map();
let standings: Map<string, Standing> = new Map();
let given: Given[] = [];
/** Answers a dispute upheld, by word and direction: accepted from then on. */
let upheld: Map<string, string[]> = new Map();
let disputesFail = false;
let held: Promise<void> | null = null;

/** Forgets every sitting, every answer and every verdict. */
export function resetMockPractice(): void {
  sittings = new Map();
  standings = new Map();
  given = [];
  upheld = new Map();
  disputesFail = false;
  held = null;
}

/** Makes "I was right" fail as when Claude cannot be reached, or work again. */
export function setMockDisputesFail(fail: boolean): void {
  disputesFail = fail;
}

/**
 * Keeps every verdict of "I was right" from arriving until the function it
 * returns is called: the time a sitting has to go on without it.
 */
export function holdMockDisputes(): () => void {
  let release = (): void => undefined;
  held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    held = null;
    release();
  };
}

/** The error a sitting command rejects with, named as Rust names it. */
export class PracticeError extends Error {
  readonly kind: "invalid" | "notFound" | "provider";

  constructor(kind: PracticeError["kind"], message: string) {
    super(message);
    this.name = "PracticeError";
    this.kind = kind;
  }
}

/** An answer as it is compared: no case, accents, punctuation or `leading`. */
function normal(text: string, leading: ReadonlySet<string>): string {
  const words = text
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const [first] = words;
  const rest =
    words.length > 1 && first !== undefined && leading.has(first)
      ? words.slice(1)
      : words;
  return rest.join(" ");
}

/** The forms of the word in its sentence: the pieces marked there. */
function bookForms(word: BookWord): string[] {
  return (CONTEXT[word.lemma] ?? [])
    .filter((part) => part.marked)
    .map((part) => part.text);
}

/** Whether the answer is right for the word asked this way. */
function isRight(word: BookWord, direction: Direction, text: string): boolean {
  const [listed, leading] =
    direction === "recognition"
      ? [word.translations, ARTICLES]
      : [[word.lemma, ...bookForms(word)], LEADING];
  const accepted = [
    ...listed,
    ...(upheld.get(`${word.id}:${direction}`) ?? []),
  ];
  const typed = normal(text, leading);
  return (
    typed !== "" && accepted.some((each) => normal(each, leading) === typed)
  );
}

function findSitting(id: string): MockSitting {
  const sitting = sittings.get(id);
  if (sitting === undefined) {
    throw new PracticeError("notFound", "sitting not found");
  }
  return sitting;
}

function isDone(standing: Standing | undefined): boolean {
  return (
    standing !== undefined &&
    DIRECTIONS.every((direction) => standing.owed[direction] === 0)
  );
}

/** The ways a word is still asked. */
function openItems(wordId: string): Asked[] {
  const standing = standings.get(wordId) ?? FRESH;
  return DIRECTIONS.filter(
    (direction) =>
      standing.owed[direction] > 0 &&
      (direction === "recognition" || standing.opened),
  ).map((direction) => ({ wordId, direction }));
}

/**
 * What the session has left to ask: its own words, less the ones finished
 * or marked as known, most frequent first, each way that is still open.
 */
function openOf(sitting: MockSitting): Asked[] {
  return mockChapterWords(sitting.chapterId)
    .filter(
      (word) => sitting.words.includes(word.id) && !word.known && !word.done,
    )
    .flatMap((word) => openItems(word.id));
}

/** What to ask next; null when the session is over. */
function nextItem(sittingId: string, sitting: MockSitting): Asked | null {
  if (sitting.finished) {
    return null;
  }
  const log = given.filter((each) => each.sittingId === sittingId);
  return nextQuestion(openOf(sitting), log);
}

/** The word as it is asked: nothing of `production` holds the English. */
export function itemOf(word: BookWord, direction: Direction): PracticeItem {
  const context = CONTEXT[word.lemma] ?? null;
  if (direction === "recognition") {
    return { wordId: word.id, direction, prompt: word.lemma, context };
  }
  return {
    wordId: word.id,
    direction,
    prompt: word.translations.join(", "),
    context:
      context?.map((part) => (part.marked ? { ...part, text: "" } : part)) ??
      null,
  };
}

/**
 * How far the session is: the right answers in a row its words stand on,
 * each way, out of the ones they take in all. A word marked as known leaves
 * both numbers; a word never answered stands on none.
 */
function progressOf(sitting: MockSitting): SittingProgress {
  const counted = mockChapterWords(sitting.chapterId).filter(
    (word) => sitting.words.includes(word.id) && !word.known,
  );
  let value = 0;
  for (const word of counted) {
    const { owed } = standings.get(word.id) ?? FRESH;
    for (const direction of DIRECTIONS) {
      value += IN_A_ROW - owed[direction];
    }
  }
  return { value, total: counted.length * DIRECTIONS.length * IN_A_ROW };
}

function stepOf(sittingId: string): PracticeStep {
  const sitting = findSitting(sittingId);
  const words = mockChapterWords(sitting.chapterId);
  const next = nextItem(sittingId, sitting);
  const word = words.find((candidate) => candidate.id === next?.wordId);
  const progress = progressOf(sitting);
  if (word === undefined || next === null) {
    sitting.finished = true;
    const done = words.filter(
      (each) => each.done && sitting.words.includes(each.id),
    );
    const open = words.filter((each) => !each.done && !each.known);
    return {
      type: "summary",
      summary: { done: done.length, open: open.length },
      // A session that is over is full, whatever became of its words since.
      progress: { value: progress.total, total: progress.total },
    };
  }
  return { type: "item", item: itemOf(word, next.direction), progress };
}

/** The chapter's words neither finished nor known, most frequent first. */
function openWords(chapterId: string): string[] {
  // An unknown chapter is refused here, as the commands refuse it.
  return mockChapterWords(chapterId)
    .filter((word) => !word.done && !word.known)
    .map((word) => word.id);
}

/**
 * The chapter's session to go on with: the one left unfinished, while it
 * has something to ask. One whose words were all settled since is closed.
 */
function heldSitting(chapterId: string): string | null {
  for (const [id, sitting] of sittings) {
    if (sitting.chapterId === chapterId && !sitting.finished) {
      if (nextItem(id, sitting) !== null) {
        return id;
      }
      sitting.finished = true;
    }
  }
  return null;
}

function options(chapterId: string): PracticeOptions {
  const open = openWords(chapterId);
  return {
    resume: heldSitting(chapterId) !== null,
    sizes: sizesFor(open.length),
  };
}

/** A session of `size` open words, or all; or the one left unfinished. */
function start(chapterId: string, size: number | null): Sitting {
  const open = openWords(chapterId);
  const left = heldSitting(chapterId);
  if (left !== null) {
    return { id: left, step: stepOf(left) };
  }
  const id = `sitting-${String(sittings.size + 1)}`;
  const words = open.slice(0, size ?? open.length);
  sittings.set(id, { chapterId, words, finished: false });
  return { id, step: stepOf(id) };
}

/**
 * The word's standing read off every answer given to it, oldest first: each
 * way owes what its run of right answers at the end lacks to be two, and
 * native → English is open once English → native has had two in a row.
 */
function recount(wordId: string, before: Standing): Standing {
  const run = { recognition: 0, production: 0 };
  let opened = false;
  for (const past of given.filter((each) => each.wordId === wordId)) {
    const { direction, correct } = past;
    run[direction] = correct ? Math.min(IN_A_ROW, run[direction] + 1) : 0;
    opened = opened || run.recognition === IN_A_ROW;
  }
  const owed = {
    recognition: IN_A_ROW - run.recognition,
    production: IN_A_ROW - run.production,
  };
  return { ...before, owed, opened };
}

/** An empty answer is "I don't know": a miss like any other. */
function answer(sittingId: string, asked: Asked, text: string): AnswerResult {
  const sitting = findSitting(sittingId);
  const { wordId, direction } = asked;
  const word = mockChapterWords(sitting.chapterId).find(
    (candidate) => candidate.id === wordId,
  );
  const before = standings.get(wordId) ?? FRESH;
  // One of the session's own questions, still open.
  const isAsked =
    !sitting.finished &&
    openOf(sitting).some(
      (open) => open.wordId === wordId && open.direction === direction,
    );
  if (word === undefined || !isAsked) {
    throw new PracticeError("invalid", "this word is not being asked");
  }
  const correct = isRight(word, direction, text);
  given.push({
    sittingId,
    wordId,
    direction,
    text: text.trim(),
    correct,
    judged: false,
  });
  const after = recount(wordId, before);
  standings.set(wordId, after);
  if (isDone(after)) {
    setMockWordDone(wordId);
  }
  return {
    answerId: given.length,
    correct,
    accepted:
      direction === "recognition" ? [...word.translations] : [word.lemma],
    step: stepOf(sittingId),
  };
}

/**
 * One answer of the refresh before reading (`ipcMockRefresh.ts`), English →
 * native, to a word that is done: whether it was right. It is kept with the
 * answers of practice, as Rust keeps it, so that a miss puts the word back
 * in practice owing two in a row that way and nothing the other. A word that
 * came done with the shelf has no answers behind it: it is given the four
 * right ones a done word has.
 */
export function answerMockRefresh(
  sittingId: string,
  word: BookWord,
  text: string,
): boolean {
  const wordId = word.id;
  const kept = { sittingId, wordId, judged: true };
  if (!standings.has(wordId)) {
    for (const direction of DIRECTIONS) {
      for (let count = 0; count < IN_A_ROW; count += 1) {
        given.push({ ...kept, direction, text: "", correct: true });
      }
    }
  }
  const before = standings.get(wordId) ?? {
    owed: { recognition: 0, production: 0 },
    opened: true,
  };
  const correct = isRight(word, "recognition", text);
  // Not to be stood by: the refresh does not offer "I was right".
  given.push({ ...kept, direction: "recognition", text: text.trim(), correct });
  // A right answer to a word that owes nothing changes nothing.
  standings.set(wordId, recount(wordId, before));
  if (!correct) {
    setMockWordDone(wordId, false);
  }
  return correct;
}

/**
 * "I know this" in a session: no answer is kept, the word leaves the
 * session, and the session goes on.
 */
function know(sittingId: string, wordId: string): PracticeStep {
  const sitting = findSitting(sittingId);
  const word = mockChapterWords(sitting.chapterId).find(
    (candidate) => candidate.id === wordId,
  );
  if (word === undefined) {
    throw new PracticeError("invalid", "this word is not being asked");
  }
  setMockWordKnown(word.lemma, true);
  return stepOf(sittingId);
}

/** The answer, if it is a typed miss that has not been judged. */
function disputable(answerId: number): Given {
  const miss = given[answerId - 1];
  if (miss === undefined) {
    throw new PracticeError("notFound", "answer not found");
  }
  if (miss.judged) {
    throw new PracticeError("invalid", "this answer was already judged");
  }
  if (miss.correct || miss.text === "") {
    throw new PracticeError("invalid", "this answer is not a miss to dispute");
  }
  return miss;
}

/**
 * "I was right" on one answer. An upheld answer becomes a right one, is
 * accepted from then on, and can finish its word; a rejected one changes
 * nothing. Either way the answer is not judged again.
 */
function dispute(answerId: number): DisputeResult {
  if (disputesFail) {
    throw new PracticeError("provider", "Claude took too long to answer");
  }
  const miss = disputable(answerId);
  const { sittingId, wordId, direction, text } = miss;
  const word = mockChapterWords(findSitting(sittingId).chapterId).find(
    (candidate) => candidate.id === wordId,
  );
  const typed = normal(text, direction === "recognition" ? ARTICLES : LEADING);
  const isUpheld = (ALSO_RIGHT[word?.lemma ?? ""] ?? []).includes(typed);
  miss.judged = true;
  const before = standings.get(wordId);
  if (isUpheld && before !== undefined) {
    miss.correct = true;
    const key = `${wordId}:${direction}`;
    upheld.set(key, [...(upheld.get(key) ?? []), text]);
    const after = recount(wordId, before);
    standings.set(wordId, after);
    if (isDone(after)) {
      setMockWordDone(wordId);
    }
  }
  return {
    upheld: isUpheld,
    reason: isUpheld
      ? `Sí: «${text}» también vale aquí.`
      : `«${text}» no es lo que esta palabra quiere decir en su frase.`,
    step: stepOf(sittingId),
  };
}

function arg(args: unknown, key: string): string {
  return String((args as Record<string, unknown>)[key]);
}

type After = <T>(ms: number, value: () => T) => Promise<T>;

export function practiceCommands(
  after: After,
): Record<string, (args: unknown) => Promise<unknown>> {
  return {
    practice_options: (args) =>
      after(80, () => options(arg(args, "chapterId"))),
    start_sitting: (args) =>
      after(150, () => {
        const { size } = args as { size?: number | null };
        return start(arg(args, "chapterId"), size ?? null);
      }),
    sitting_step: (args) => after(80, () => stepOf(arg(args, "sittingId"))),
    know_word: (args) =>
      after(80, () => know(arg(args, "sittingId"), arg(args, "wordId"))),
    dispute_answer: async (args) => {
      // The model takes its time; the sitting does not wait for it.
      await (held ?? Promise.resolve());
      return after(900, () => dispute(Number(arg(args, "answerId"))));
    },
    answer_word: (args) =>
      after(80, () =>
        answer(
          arg(args, "sittingId"),
          {
            wordId: arg(args, "wordId"),
            direction:
              arg(args, "direction") === "production"
                ? "production"
                : "recognition",
          },
          arg(args, "answer"),
        ),
      ),
  };
}
