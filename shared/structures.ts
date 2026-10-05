/**
 * The types of the structures section that cross the Tauri bridge: the part
 * of `shared/domain.ts` that is about structures, in a file of its own. Its
 * mirror is in `src-tauri/src/domain.rs`, which wins a disagreement.
 */
import type { Chapter, Level, PartOfSpeech, Strength } from "./domain.ts";

/** What a sentence written with a structure is worth: the verdict scale. */
export type StructureVerdict = "correct" | "partial" | "wrong";

/** Where a word was met: the chapter being read, or the words learned. */
export type WordSource = "chapter" | "recall";

/**
 * One structure of the catalogue, and how it stands for the learner. How it
 * is built and when it is used are worded by the interface, by its key.
 */
export interface StructureInfo {
  key: string;
  level: Level;
  /** What grammars call it, in English. */
  name: string;
  example: string;
  /** From the sessions on it alone: never "mastered". */
  strength: Strength;
  /** It was practised, and it is time to practise it again. */
  due: boolean;
}

/** A structure a chapter uses. */
export interface ChapterStructure {
  key: string;
  /** Sentences that use it, in what was read of the chapter. */
  count: number;
  /** One of them; empty when none could be shown. */
  example: string;
}

/** The structures of the chapter the learner is on, the most used first. */
export interface ChapterStructures {
  bookTitle: string;
  chapter: Chapter;
  /** The chapter was read for them; until then there are none. */
  scanned: boolean;
  structures: ChapterStructure[];
}

/** A session left before its end, to go on with. */
export interface StructureSittingInfo {
  id: string;
  startedAt: string;
  done: number;
  total: number;
  /** The keys of its structures. */
  structures: string[];
}

/** The menu of the structures. */
export interface StructuresState {
  structures: StructureInfo[];
  paused: StructureSittingInfo[];
  /** The chapter opened last; null before any was. */
  chapter: ChapterStructures | null;
}

/** What a sentence is asked to be about. */
export type Topic =
  { kind: "preset"; key: string } | { kind: "interest"; label: string };

/** A word of the books a sentence is asked to use. */
export interface StructureWord {
  /** Its base form. */
  english: string;
  source: WordSource;
  /** Null for a word nobody labelled. */
  partOfSpeech: PartOfSpeech | null;
  /** In the learner's language: what its chapter was prepared with. */
  translations: string[];
}

/** One sentence to write. */
export interface StructureItem {
  index: number;
  /** The key of its structure. */
  structure: string;
  /** What grammars call the structure, in English. */
  name: string;
  level: Level;
  /** A sentence that has it. */
  example: string;
  /**
   * What it is about; null when a word is asked for, which is then what
   * the sentence is built on.
   */
  topic: Topic | null;
  word: StructureWord | null;
  /** Part of the warm-up: the form of the structure is in sight. */
  warm: boolean;
}

/** What a sentence was worth, and why. */
export interface StructureResult {
  verdict: StructureVerdict;
  /** In the learner's language. */
  explanation: string;
  /** A right sentence with the structure, close to the learner's. */
  better: string;
  /** The word asked for is in the sentence; true when none was asked. */
  usedWord: boolean;
}

/** How the sentences on one structure went in a session. */
export interface StructureTally {
  key: string;
  /** Sentences not wrong. */
  right: number;
  total: number;
}

/** How a session ended, by verdict and by structure, the weakest first. */
export interface StructureSummary {
  correct: number;
  partial: number;
  wrong: number;
  structures: StructureTally[];
}

/**
 * A session as it stands: the sentence to write next, or, once it is
 * finished, how it ended.
 */
export interface StructureSitting {
  id: string;
  /** How many sentences it was started with: a missed one adds to it. */
  size: number;
  /** The keys of its structures, in the order they first come. */
  structures: string[];
  /** The chapter its words are from, when it is a session on one. */
  chapterId: string | null;
  done: number;
  total: number;
  item: StructureItem | null;
  summary: StructureSummary | null;
}
