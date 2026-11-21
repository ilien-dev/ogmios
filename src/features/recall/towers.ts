import type { Strength, VocabEntry } from "@shared/domain";

/** The tallest a tower stands, in floors, however many words it holds. */
export const MAX_FLOORS = 12;
/** The words a floor holds while they are few. */
const MIN_PER_FLOOR = 4;

export interface TowerPlan {
  /** The words one floor stands for, the same in every tower. */
  per: number;
  floors: Record<Strength, number>;
}

/**
 * How the learned words stand as towers, one per strength: a floor for every
 * few words, and more words to a floor once the tallest would outgrow the
 * scene. A strength with no words has no floor.
 */
export function planTowers(counts: Record<Strength, number>): TowerPlan {
  const top = Math.max(counts.new, counts.settling, counts.firm);
  const per = Math.max(MIN_PER_FLOOR, Math.ceil(top / MAX_FLOORS));
  const floors = (count: number): number => Math.ceil(Math.max(0, count) / per);
  return {
    per,
    floors: {
      new: floors(counts.new),
      settling: floors(counts.settling),
      firm: floors(counts.firm),
    },
  };
}

/**
 * The words a tower names beside it: the latest of each strength, `shown` at
 * most, each word once. The vocabulary comes latest first; a word the review
 * does not ask has no tower.
 */
export function wordsByStrength(
  vocabulary: readonly VocabEntry[],
  shown: number,
): Record<Strength, string[]> {
  const words: Record<Strength, string[]> = { new: [], settling: [], firm: [] };
  for (const entry of vocabulary) {
    if (entry.strength === null) {
      continue;
    }
    const list = words[entry.strength];
    if (list.length < shown && !list.includes(entry.english)) {
      list.push(entry.english);
    }
  }
  return words;
}
