/**
 * The steps a word written alike to another one in another sense is asked
 * on: `Ladder`, `SenseHint` and `SenseTip` in `src-tauri/src/domain.rs`,
 * with `SentenceProgress`, kept apart from `domain.ts` only for its length. The rules are
 * `src-tauri/src/commands/ladder.rs`.
 */
import type { PartOfSpeech, SentencePart, VerbForm } from "./domain.ts";

/**
 * What a word written alike to another one in another sense is asked with
 * on its next step: told which word the answer was and the kind asked for,
 * then shown its sentence.
 */
export interface Ladder {
  /** The step it is on now: 1 told the kind of word, 2 shown the sentence. */
  rung: number;
  /** On step 1: which word the answer was. */
  hint: SenseHint | null;
  /** On step 2: the sentence, the word marked. */
  context: SentencePart[] | null;
  /**
   * The word was asked with the few words that fix its sense, not its whole
   * sentence: what step 2 shows is more than it had.
   */
  short: boolean;
}

/** The other word an answer meant. */
export interface SenseHint {
  /** What the answer said, as that word means it. */
  meaning: string;
  /** The title of its book; null when it is the book of the word asked. */
  book: string | null;
  /** Its chapter, from 1, and the chapter's title. */
  chapter: number;
  chapterTitle: string;
  /** The kind of the word asked, and of the other one. */
  asked: PartOfSpeech | null;
  given: PartOfSpeech | null;
  /**
   * The form a verb is asked in, and the form the other one had; null for
   * any other word, and where nobody said.
   */
  askedForm: VerbForm | null;
  givenForm: VerbForm | null;
}

/** Right only once the sentence was shown: what to look at next time. */
export interface SenseTip {
  /** The kind of the word asked. */
  kind: PartOfSpeech | null;
  /** Its rivals are another kind of word: its tag tells them apart. */
  kindsDiffer: boolean;
  /**
   * Its tag cannot tell it from a rival: it is asked with the few words that
   * fix its sense, and was right only with its whole sentence.
   */
  tied: boolean;
  /** It was asked with those few words, not its whole sentence. */
  short: boolean;
  /** Those few words, the word marked; null when not asked with them. */
  example: SentencePart[] | null;
  /** What the word is in them, in the learner's language; null as above. */
  meaning: string | null;
}

/** Event `sentence-progress`: words given their sentences so far. */
export interface SentenceProgress {
  /** The chapter whose words they are; null for the words of the recall. */
  chapterId: string | null;
  done: number;
  total: number;
  /** The words of the chapter, or of the recall. */
  words: number;
  /** How many of those can be asked with a sentence already. */
  ready: number;
  /** The sentences those have. */
  sentences: number;
}
