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
