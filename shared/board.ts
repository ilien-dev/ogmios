/**
 * What the column beside a book's scene counts, as `src-tauri/src/domain.rs`
 * has it: kept apart from `domain.ts` only for its length. The counts are
 * `src-tauri/src/commands/board.rs`.
 */
import type { PartOfSpeech } from "./domain.ts";

/**
 * How strong the words learned in a chapter are, counted by strength:
 * `fresh` ones are new.
 */
export interface ChapterStrength {
  chapterId: string;
  fresh: number;
  settling: number;
  firm: number;
}

/**
 * How many of the words the daily review asks today are of a book, and about
 * how many minutes they take.
 */
export interface BookReviews {
  due: number;
  minutes: number;
}

/**
 * How many words of a chapter are of one kind, and how many of them are
 * learned. `kind` is null for the words nobody labelled.
 */
export interface KindCount {
  kind: PartOfSpeech | null;
  learned: number;
  total: number;
}
