/** What the daily review brings back: each is a run of its own. */
export type TodayKind = "words" | "drills" | "structures";

/** In the order the review goes through them. */
export const TODAY_KINDS: readonly TodayKind[] = [
  "words",
  "drills",
  "structures",
];

export interface TodayItem {
  kind: TodayKind;
  /** How many of them come back today. */
  count: number;
}

/** The daily review, as one queue. */
export interface TodayQueue {
  /** Every kind, in order, also the ones with nothing today. */
  items: TodayItem[];
  /** Everything that comes back today: the count the navigation shows. */
  total: number;
  /** The kind the review starts with; null when nothing comes back. */
  next: TodayKind | null;
}

/**
 * The daily review from what is due of each kind: learned words (from the
 * books and from what was asked in a conversation), the drills of the
 * patterns heard in conversations, and the structures written before.
 */
export function todayQueue(due: Record<TodayKind, number>): TodayQueue {
  const items = TODAY_KINDS.map((kind) => ({
    kind,
    count: Math.max(0, due[kind]),
  }));
  return {
    items,
    total: items.reduce((sum, each) => sum + each.count, 0),
    next: items.find((each) => each.count > 0)?.kind ?? null,
  };
}

/** The tallest a tower of the relief stands, and the count that reaches it. */
const TALL = 96;
const FULL = 12;
/** A kind with nothing today lies flat; one thing already stands. */
const FLAT = 6;
const LOW = 22;

/** How tall a kind's tower stands in the relief: as tall as what comes back. */
export function towerHeight(count: number): number {
  if (count <= 0) {
    return FLAT;
  }
  const share = (Math.min(count, FULL) - 1) / (FULL - 1);
  return Math.round(LOW + share * (TALL - LOW));
}
