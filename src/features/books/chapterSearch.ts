import type { Chapter } from "@shared/domain";
import { findChapters } from "./bookTabs";

/** How many chapters a search shows: a book can have more than a thousand. */
export const FOUND = 40;

/**
 * The chapters a search by number or title finds: the one with that number
 * first, then the others in reading order. Nothing for nothing asked.
 */
export function searchChapters(
  chapters: readonly Chapter[],
  query: string,
  name: (chapter: Chapter) => string,
): Chapter[] {
  const asked = query.trim();
  if (asked === "") {
    return [];
  }
  const found = findChapters(chapters, asked, name);
  const numbered = found.find((each) => String(each.index + 1) === asked);
  const rest = found.filter((each) => each !== numbered);
  return (numbered === undefined ? rest : [numbered, ...rest]).slice(0, FOUND);
}
