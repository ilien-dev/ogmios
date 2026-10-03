/**
 * The mock's rule for a session of practice: `next`, `sizes` and `minutes`
 * of `src-tauri/src/books/practice.rs` in small. Which question a session
 * asks next is read off what it has left to ask and the answers given in it,
 * and nothing else: no clock ends a session and nothing caps its words.
 *
 * One thing is simpler here than in Rust: the estimate always counts eight
 * seconds an answer. The mock keeps no times to read a learner's pace from.
 */
import type { Direction, SessionSize } from "@shared/domain";

/** Other questions that come between two about the same word. */
const SPACING = 5;
/** The sizes a session is offered in, beside every open word. */
const SIZES: readonly number[] = [10, 20, 40];
const ANSWERS_PER_WORD = 5;
const SECONDS_PER_ANSWER = 8;

/** A word in one direction. */
export interface Asked {
  wordId: string;
  direction: Direction;
}

/** One answer given in a session; a session's log is these, oldest first. */
export interface Logged extends Asked {
  correct: boolean;
}

/** Where the word was last asked in the session, either way; -1 if never. */
function askedAt(log: readonly Logged[], wordId: string): number {
  return log.map((given) => given.wordId).lastIndexOf(wordId);
}

/** Where the question was last missed, if its latest answer was a miss. */
function missedAt(log: readonly Logged[], asked: Asked): number | null {
  const at = log
    .map((given) => `${given.direction}:${given.wordId}`)
    .lastIndexOf(`${asked.direction}:${asked.wordId}`);
  return at !== -1 && log[at]?.correct === false ? at : null;
}

/** The first of the questions whose word was asked longest ago. */
function longestAgo(
  log: readonly Logged[],
  questions: readonly Asked[],
): Asked | null {
  let found: Asked | null = null;
  let least = Infinity;
  for (const question of questions) {
    const at = askedAt(log, question.wordId);
    if (at < least) {
      found = question;
      least = at;
    }
  }
  return found;
}

/**
 * The question a session asks next, or null when it is over. `open` is what
 * it has left to ask, most frequent word first, English → native before
 * native → English; `log` the answers given in it.
 *
 * A missed question comes back as soon as five other questions have been
 * asked since its word, the oldest miss first. Otherwise the pass goes on
 * with the word asked longest ago among those five questions back, a word
 * not asked yet first. With none that far back, near the end, the word asked
 * longest ago is taken: never the same word twice in a row while another is
 * open.
 */
export function nextQuestion(
  open: readonly Asked[],
  log: readonly Logged[],
): Asked | null {
  const spaced = open.filter((question) => {
    const at = askedAt(log, question.wordId);
    return at < 0 || log.length - at > SPACING;
  });
  let missed: Asked | null = null;
  let oldest = Infinity;
  for (const question of spaced) {
    const at = missedAt(log, question);
    if (at !== null && at < oldest) {
      missed = question;
      oldest = at;
    }
  }
  return missed ?? longestAgo(log, spaced) ?? longestAgo(log, open);
}

/** About how many minutes a session of this many words takes. */
function minutes(words: number): number {
  if (words === 0) {
    return 0;
  }
  const seconds = words * ANSWERS_PER_WORD * SECONDS_PER_ANSWER;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * The sizes on offer for a chapter with `open` words to practise: every
 * size it has more open words than, and then all of them.
 */
export function sizesFor(open: number): SessionSize[] {
  return [
    ...SIZES.filter((size) => open > size).map((size) => ({
      size,
      words: size,
      minutes: minutes(size),
    })),
    { size: null, words: open, minutes: minutes(open) },
  ];
}
