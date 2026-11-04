import type { Chapter } from "@shared/domain";
import { READY } from "@shared/domain";

/**
 * The chapters a chart has room for, around the current one: a book can
 * have more than a thousand. Without a current chapter, the first ones.
 */
export function chapterWindow(
  chapters: readonly Chapter[],
  currentId: string | null,
  size: number,
): Chapter[] {
  if (chapters.length <= size) {
    return [...chapters];
  }
  const at = Math.max(
    0,
    chapters.findIndex((chapter) => chapter.id === currentId),
  );
  const start = Math.min(
    Math.max(0, at - Math.floor((size - 1) / 2)),
    chapters.length - size,
  );
  return chapters.slice(start, start + size);
}

/** Where a chapter's vocabulary stands, as its bar shows it. */
export type BarState = "unprepared" | "learning" | "ready";

export function barState(chapter: Chapter): BarState {
  if (chapter.readiness === null) {
    return "unprepared";
  }
  return chapter.readiness >= READY ? "ready" : "learning";
}

export interface WordDots {
  /** How many words one dot stands for. */
  unit: number;
  learned: number;
  known: number;
}

/**
 * The words the learner has, as at most `max` dots: one a word while they
 * fit, else one per `unit` words, rounded up so that a single word still
 * shows.
 */
export function wordDots(
  learned: number,
  known: number,
  max: number,
): WordDots {
  const unit = Math.max(1, Math.ceil((learned + known) / max));
  const learnedDots = Math.ceil(learned / unit);
  return {
    unit,
    learned: learnedDots,
    known: Math.min(Math.ceil(known / unit), max - learnedDots),
  };
}
