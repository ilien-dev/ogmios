import type { Book, Chapter } from "@shared/domain";

/** The chapter the learner is on, with the book it is of. */
export interface Current {
  book: Book;
  chapter: Chapter;
}

/**
 * The chapter of that id as the shelf has it now; null for none, and for
 * one whose book is no longer there.
 */
export function currentOf(
  books: readonly Book[],
  chapterId: string | null,
): Current | null {
  for (const book of books) {
    const chapter = book.chapters.find((each) => each.id === chapterId);
    if (chapter !== undefined) {
      return { book, chapter };
    }
  }
  return null;
}

/**
 * The chapter the learner is on: the one of that id, or else the first of
 * the first book that has any, so that a shelf with a book always has one.
 */
export function chapterOn(
  books: readonly Book[],
  chapterId: string | null,
): Current | null {
  const held = currentOf(books, chapterId);
  if (held !== null) {
    return held;
  }
  for (const book of books) {
    const [chapter] = book.chapters;
    if (chapter !== undefined) {
      return { book, chapter };
    }
  }
  return null;
}
