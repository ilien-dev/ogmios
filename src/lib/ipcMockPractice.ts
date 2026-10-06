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
 * long that takes. One started in one way alone asks that way from the
 * start and ends when it is finished: its words are then half done. One left before that is gone on with by the next
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
  WordHint,
  BookWord,
  Direction,
  DisputeResult,
  PracticeItem,
  PracticeOptions,
  PracticeStep,
  SentencePart,
  Sitting,
  SittingProgress,
  Ways,
} from "@shared/domain";
import { mockChapterWords } from "./ipcMockChapters";
import { nextQuestion, sizesFor } from "./ipcMockSession";
import type { Asked } from "./ipcMockSession";
import {
  setMockWordDone,
  setMockWordHalf,
  setMockWordKnown,
} from "./ipcMockWords";

const IN_A_ROW = 2;
const DIRECTIONS: readonly Direction[] = ["recognition", "production"];
const WAYS: readonly Ways[] = ["both", "recognition", "production"];
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
  /** Given in the refresh before reading. */
  refresh?: true;
}

interface MockSitting {
  id: string;
  chapterId: string;
  /** The words it was started with, most frequent first. */
  words: readonly string[];
  /** The ways it asks them in. */
  ways: Ways;
  /**
   * An extra review: started in ways nothing was owed in, it asks its words
   * anyway, done ones included, each counted from the answers given in it.
   */
  extra: boolean;
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

/**
 * The English the word is asked for: the forms its sentence is blanked of,
 * or its base form when it is asked without one.
 */
function english(word: BookWord): string[] {
  const forms = bookForms(word);
  return forms.length > 0 ? forms : [word.lemma];
}

/** The mock asks no word with a sentence of a bank: nothing to add. */
export const PLAIN = {
  again: false,
  another: null,
  helped: false,
  exact: null,
  sentence: null,
};

/** A word as an exercise shows it: `commands::practice::small`. */
export function small(texts: readonly string[]): string[] {
  return texts.map((text) => text.toLowerCase());
}

/**
 * A hint to the word asked this way: `books::hint::mask` in small. The mock
 * keeps no sentence back: a word shows its own from the start or has none,
 * so every hint is to the answer.
 */
export function hintOf(
  word: BookWord,
  direction: Direction,
  letters: number,
): WordHint {
  const whole =
    (direction === "recognition" ? word.translations[0] : english(word)[0]) ??
    word.lemma;
  const chars = Array.from(whole.toLowerCase());
  const isLetter = (char: string): boolean => /[\p{L}\p{N}]/u.test(char);
  const most = Math.max(chars.filter(isLetter).length - 1, 0);
  const shown = Math.min(letters, most);
  const mask = chars
    .map((char, at) => {
      const before = chars.slice(0, at).filter(isLetter).length;
      return isLetter(char) && before >= shown ? "_" : char;
    })
    .join("");
  return { mask, context: null, more: letters < most };
}

/** Whether the answer is right for the word asked this way. */
export function isRight(
  word: BookWord,
  direction: Direction,
  text: string,
): boolean {
  const [listed, leading] =
    direction === "recognition"
      ? [word.translations, ARTICLES]
      : [english(word), LEADING];
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

/** The directions a session of `ways` asks. */
function directionsOf(ways: Ways): readonly Direction[] {
  return ways === "both" ? DIRECTIONS : [ways];
}

/**
 * Where a word stands going by `past`, its answers oldest first: each way
 * owes what its run of right answers at the end lacks to be two, and native
 * → English is open once English → native has had two in a row. A miss in
 * the refresh before reading starts the word over, both ways.
 */
function tally(past: readonly Given[]): Standing {
  let run = { recognition: 0, production: 0 };
  let opened = false;
  for (const { direction, correct, refresh } of past) {
    if (refresh === true && !correct) {
      run = { recognition: 0, production: 0 };
      opened = false;
      continue;
    }
    run[direction] = correct ? Math.min(IN_A_ROW, run[direction] + 1) : 0;
    opened = opened || run.recognition === IN_A_ROW;
  }
  const owed = {
    recognition: IN_A_ROW - run.recognition,
    production: IN_A_ROW - run.production,
  };
  return { owed, opened };
}

/**
 * Where a word stands for a session: as every answer left it, or, in an
 * extra review, as the answers given in that session alone leave it.
 */
function standingIn(sitting: MockSitting, wordId: string): Standing {
  if (!sitting.extra) {
    return standings.get(wordId) ?? FRESH;
  }
  return tally(
    given.filter(
      (each) => each.sittingId === sitting.id && each.wordId === wordId,
    ),
  );
}

/**
 * The ways a word that stands at `standing` is still asked in a session of
 * `ways`. Both ways wait for English → native to be finished before the
 * other one; one way alone is asked from the start.
 */
function openItems(wordId: string, ways: Ways, standing: Standing): Asked[] {
  return directionsOf(ways)
    .filter(
      (direction) =>
        standing.owed[direction] > 0 &&
        (ways !== "both" || direction === "recognition" || standing.opened),
    )
    .map((direction) => ({ wordId, direction }));
}

/**
 * What the session has left to ask: its own words, less the ones finished
 * or marked as known, most frequent first, each way that is still open. An
 * extra review asks a finished word too.
 */
function openOf(sitting: MockSitting): Asked[] {
  return mockChapterWords(sitting.chapterId)
    .filter(
      (word) =>
        sitting.words.includes(word.id) &&
        !word.known &&
        (sitting.extra || !word.done),
    )
    .flatMap((word) =>
      openItems(word.id, sitting.ways, standingIn(sitting, word.id)),
    );
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
    return {
      wordId: word.id,
      direction,
      prompt: word.lemma.toLowerCase(),
      partOfSpeech: word.partOfSpeech,
      context,
      sentenceId: null,
      verbForm: null,
    };
  }
  return {
    wordId: word.id,
    direction,
    prompt: small(word.translations).join(", "),
    partOfSpeech: word.partOfSpeech,
    context:
      context?.map((part) => (part.marked ? { ...part, text: "" } : part)) ??
      null,
    sentenceId: null,
    verbForm: null,
  };
}

/**
 * How far the session is: the right answers in a row its words stand on,
 * each way it asks, out of the ones they take in all. A word marked as known leaves
 * both numbers; a word never answered stands on none.
 */
function progressOf(sitting: MockSitting): SittingProgress {
  const counted = mockChapterWords(sitting.chapterId).filter(
    (word) => sitting.words.includes(word.id) && !word.known,
  );
  const asked = directionsOf(sitting.ways);
  let value = 0;
  for (const word of counted) {
    const { owed } = standingIn(sitting, word.id);
    for (const direction of asked) {
      value += IN_A_ROW - owed[direction];
    }
  }
  return { value, total: counted.length * asked.length * IN_A_ROW };
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

/**
 * The chapter's words neither finished nor known that have something to ask
 * in `ways`, most frequent first.
 */
function openWords(chapterId: string, ways: Ways = "both"): string[] {
  // An unknown chapter is refused here, as the commands refuse it.
  return mockChapterWords(chapterId)
    .filter((word) => !word.done && !word.known)
    .map((word) => word.id)
    .filter((id) => openItems(id, ways, standings.get(id) ?? FRESH).length > 0);
}

/**
 * Whether a session of `ways` on the chapter is an extra review: none of
 * its open words has anything left to ask that way.
 */
function isExtra(chapterId: string, ways: Ways): boolean {
  return openWords(chapterId, ways).length === 0;
}

/**
 * The words a session of `ways` draws from: the open ones with something to
 * ask that way, or, for an extra review, every word not marked as known.
 */
function wordsFor(chapterId: string, ways: Ways): string[] {
  if (!isExtra(chapterId, ways)) {
    return openWords(chapterId, ways);
  }
  return mockChapterWords(chapterId)
    .filter((word) => !word.known)
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
  const offered = (ways: Ways): PracticeOptions["sizes"] =>
    sizesFor(wordsFor(chapterId, ways).length, ways);
  return {
    resume: heldSitting(chapterId) !== null,
    sizes: offered("both"),
    oneWay: {
      recognition: offered("recognition"),
      production: offered("production"),
    },
    extra: WAYS.filter((ways) => isExtra(chapterId, ways)),
  };
}

/**
 * A session of `size` open words asked in `ways`, or all of them; or the one
 * left unfinished, with the words and the ways it had. With nothing left to
 * ask in `ways` it is an extra review.
 */
function start(chapterId: string, size: number | null, ways: Ways): Sitting {
  const open = wordsFor(chapterId, ways);
  const extra = isExtra(chapterId, ways);
  const left = heldSitting(chapterId);
  if (left !== null) {
    return { id: left, step: stepOf(left) };
  }
  const id = `sitting-${String(sittings.size + 1)}`;
  const words = open.slice(0, size ?? open.length);
  sittings.set(id, { id, chapterId, words, ways, extra, finished: false });
  return { id, step: stepOf(id) };
}

/** Keeps where the word stands, and what the word list says of it. */
function stand(wordId: string, standing: Standing): void {
  standings.set(wordId, standing);
  const finished = DIRECTIONS.filter(
    (direction) => standing.owed[direction] === 0,
  );
  const [only] = finished;
  setMockWordHalf(wordId, finished.length === 1 ? (only ?? null) : null);
  setMockWordDone(wordId, isDone(standing));
}

/**
 * A word that came done with the shelf has no answers behind it: it is
 * given the four right ones a done word has, as of the sitting `sittingId`.
 */
function backfill(wordId: string, sittingId: string): void {
  if (standings.has(wordId)) {
    return;
  }
  const kept = { sittingId, wordId, judged: true, text: "", correct: true };
  for (const direction of DIRECTIONS) {
    for (let count = 0; count < IN_A_ROW; count += 1) {
      given.push({ ...kept, direction });
    }
  }
}

/**
 * The word's standing read off every answer given to it, oldest first: each
 * way owes what its run of right answers at the end lacks to be two, and
 * native → English is open once English → native has had two in a row.
 */
function recount(wordId: string, before: Standing): Standing {
  return {
    ...before,
    ...tally(given.filter((each) => each.wordId === wordId)),
  };
}

/**
 * An empty answer is "I don't know": a miss like any other. A right one
 * given after a hint is a helped one.
 */
function answer(
  sittingId: string,
  asked: Asked,
  text: string,
  hinted = false,
): AnswerResult {
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
  if (word.done) {
    // Only an extra review asks a done word; its past is no part of it.
    backfill(wordId, "");
  }
  given.push({
    sittingId,
    wordId,
    direction,
    text: text.trim(),
    correct,
    judged: false,
  });
  stand(wordId, recount(wordId, before));
  return {
    answerId: given.length,
    correct,
    accepted: small(
      direction === "recognition" ? word.translations : english(word),
    ),
    step: stepOf(sittingId),
    ...PLAIN,
    helped: correct && hinted,
  };
}

/** The hint to a word of the session's chapter, asked this way. */
function hint(sittingId: string, asked: Asked, letters: number): WordHint {
  const word = mockChapterWords(findSitting(sittingId).chapterId).find(
    (candidate) => candidate.id === asked.wordId,
  );
  if (word === undefined) {
    throw new PracticeError("invalid", "this word is not being asked");
  }
  return hintOf(word, asked.direction, letters);
}

/**
 * One answer of the refresh before reading (`ipcMockRefresh.ts`), English →
 * native, to a word that is done: whether it was right. It is kept with the
 * answers of practice, as Rust keeps it, so that a miss puts the word back
 * in practice owing two in a row both ways, English → native first. A word that
 * came done with the shelf has no answers behind it ([`backfill`]).
 */
export function answerMockRefresh(
  sittingId: string,
  word: BookWord,
  text: string,
): boolean {
  const wordId = word.id;
  const kept = { sittingId, wordId, judged: true };
  backfill(wordId, sittingId);
  const before = standings.get(wordId) ?? {
    owed: { recognition: 0, production: 0 },
    opened: true,
  };
  const correct = isRight(word, "recognition", text);
  // Not to be stood by: the refresh does not offer "I was right".
  given.push({
    ...kept,
    direction: "recognition",
    text: text.trim(),
    correct,
    refresh: true,
  });
  // A right answer to a word that owes nothing changes nothing.
  stand(wordId, recount(wordId, before));
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
    stand(wordId, recount(wordId, before));
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
        const { size, ways } = args as { size?: number | null; ways?: Ways };
        return start(arg(args, "chapterId"), size ?? null, ways ?? "both");
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
          (args as { tries?: { hinted?: boolean } }).tries?.hinted === true,
        ),
      ),
    hint_word: (args) =>
      after(60, () =>
        hint(
          arg(args, "sittingId"),
          {
            wordId: arg(args, "wordId"),
            direction:
              arg(args, "direction") === "production"
                ? "production"
                : "recognition",
          },
          Number(arg(args, "asked")),
        ),
      ),
  };
}
