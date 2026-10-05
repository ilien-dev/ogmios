/**
 * The types of the listening section that cross the Tauri bridge: the part
 * of `shared/domain.ts` that is about listening, in a file of its own. Its
 * mirror is in `src-tauri/src/domain.rs`, which wins a disagreement.
 */
import type { Chapter, SentencePart } from "./domain.ts";
import type { StructureVerdict } from "./structures.ts";

/** How fast a sentence is read aloud: each one is a level. */
export type Pace = "slow" | "normal" | "fast";

/** Every pace, slowest first. */
export const PACES: readonly Pace[] = ["slow", "normal", "fast"];

/** What a finished dictation suggests about the pace of the next. */
export type PaceHint = "slower" | "faster";

/** How the learner hears at one pace, over their latest sentences at it. */
export interface PaceStanding {
  pace: Pace;
  /** Words heard, out of `total`. */
  right: number;
  total: number;
  sentences: number;
  /** Enough of them were heard, over enough sentences: the pace is theirs. */
  held: boolean;
}

/** A word that escapes the learner's ear. */
export interface MissedWord {
  word: string;
  times: number;
}

/** The chapter the listening is on. */
export interface ListeningChapter {
  bookId: string;
  bookTitle: string;
  chapter: Chapter;
  /** How many sentences it is read in. */
  sentences: number;
  /** The sentence the reading was left at. */
  place: number;
}

/** A dictation left before its end. */
export interface DictationInfo {
  id: string;
  done: number;
  total: number;
  startedAt: string;
}

/** The listening menu. */
export interface ListeningState {
  /** The fastest pace understood; null before any is. */
  understood: Pace | null;
  /** The pace a dictation is offered at. */
  pace: Pace;
  /** Slowest first. */
  standings: PaceStanding[];
  missed: MissedWord[];
  /** The words the next dictations keep sentences for. */
  reinforced: string[];
  paused: DictationInfo[];
  /** The chapter asked for, or the one opened last; null without one. */
  chapter: ListeningChapter | null;
}

/**
 * A chapter to listen to: its sentences by paragraph, each in pieces with
 * the words the learner has learned marked.
 */
export interface ChapterReading {
  bookId: string;
  bookTitle: string;
  chapter: Chapter;
  paragraphs: SentencePart[][][];
  /** The sentence the reading was left at, counted across paragraphs. */
  place: number;
}

/** Event `chapter-listening`: the sentence being read aloud. */
export interface ChapterListening {
  chapterId: string;
  sentence: number;
}

/** The sentence a dictation is on. What it says is only heard. */
export interface DictationItem {
  index: number;
  /** How often it was listened to. */
  listens: number;
  /** The slowest pace it was heard at; null before it is. */
  pace: Pace | null;
  /** It was missed earlier in the session and is back. */
  retry: boolean;
}

/** How a finished dictation went. */
export interface DictationSummary {
  correct: number;
  partial: number;
  wrong: number;
  /** Words heard, out of `total`. */
  right: number;
  total: number;
  /** The pace most of it was answered at. */
  pace: Pace;
  hint: PaceHint | null;
  /** The fastest pace understood, after it. */
  understood: Pace | null;
}

/** A dictation as it stands. */
export interface Dictation {
  id: string;
  /** Null once its book is gone. */
  chapterId: string | null;
  /** The pace it was started at. */
  pace: Pace;
  done: number;
  total: number;
  /** Null once every sentence is answered. */
  item: DictationItem | null;
  /** Only once it is finished. */
  summary: DictationSummary | null;
}

/** One word of a dictated sentence, and whether it was typed. */
export interface HeardWord {
  text: string;
  heard: boolean;
}

/** What an answer to a dictated sentence was worth. */
export interface DictationResult {
  verdict: StructureVerdict;
  sentence: string;
  words: HeardWord[];
  listens: number;
  /** It was slowed down after it had been heard. */
  slowed: boolean;
}
