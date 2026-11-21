import type { Chapter } from "@shared/domain";
import { READY } from "@shared/domain";
import type { BookTab } from "@/app/routes";

/**
 * What a chapter asks for next: its words until every one is done or known,
 * and then listening to it, which is the first thing done with a chapter
 * that is ready to read.
 */
export function nextTab(chapter: Chapter): BookTab {
  return chapter.readiness === READY ? "listen" : "words";
}

/** The chapters of a book that a search by number or by name finds. */
export function findChapters(
  chapters: readonly Chapter[],
  query: string,
  name: (chapter: Chapter) => string,
): Chapter[] {
  const asked = query.trim().toLowerCase();
  if (asked === "") {
    return [...chapters];
  }
  return chapters.filter(
    (chapter) =>
      String(chapter.index + 1) === asked ||
      name(chapter).toLowerCase().includes(asked),
  );
}
