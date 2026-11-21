import type { Chapter } from "@shared/domain";
import { READY } from "@shared/domain";
import { findChapters } from "./bookTabs";

/** How many chapters a search shows: a book can have more than a thousand. */
export const FOUND = 40;
/** How many chapters under way, and after the current one, the search offers. */
const GOING = 5;
const NEXT = 3;

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

/** The places in the book a search offers in one step. */
export interface Jumps {
  firstUnprepared?: Chapter;
  lastReady?: Chapter;
  last?: Chapter;
}

export interface Shortcuts {
  /** The current chapter, then the others prepared and not yet ready. */
  going: Chapter[];
  /** The chapters right after the current one that are not under way. */
  next: Chapter[];
  jumps: Jumps;
}

function underWay(chapter: Chapter): boolean {
  return chapter.readiness !== null && chapter.readiness < READY;
}

/**
 * What the search offers before anything is typed: where the learner is,
 * what follows, and a jump to the first chapter to prepare, the last one
 * ready and the end of the book. A jump to where the learner is is no jump.
 */
export function chapterShortcuts(
  chapters: readonly Chapter[],
  currentId: string,
): Shortcuts {
  const at = chapters.findIndex((each) => each.id === currentId);
  const current = chapters[at];
  const going = [
    ...(current === undefined ? [] : [current]),
    ...chapters.filter((each) => each.id !== currentId && underWay(each)),
  ].slice(0, GOING);
  const next = chapters
    .slice(at + 1)
    .filter((each) => !going.includes(each))
    .slice(0, NEXT);
  const elsewhere = (each: Chapter | undefined): Chapter | undefined =>
    each === undefined || each.id === currentId ? undefined : each;
  const jumps: Jumps = {};
  const firstUnprepared = elsewhere(
    chapters.find((each) => each.readiness === null),
  );
  const lastReady = elsewhere(
    [...chapters].reverse().find((each) => (each.readiness ?? 0) >= READY),
  );
  const last = elsewhere(chapters.at(-1));
  if (firstUnprepared !== undefined) {
    jumps.firstUnprepared = firstUnprepared;
  }
  if (lastReady !== undefined) {
    jumps.lastReady = lastReady;
  }
  if (last !== undefined) {
    jumps.last = last;
  }
  return { going, next, jumps };
}
