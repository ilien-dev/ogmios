import type { KindCount } from "@shared/board";
import type { PartOfSpeech } from "@shared/domain";

/** The kinds the board names, in the order it shows them. */
export const KIND_GROUPS = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "expression",
  "other",
] as const;

export type KindGroup = (typeof KIND_GROUPS)[number];

export interface KindTally {
  group: KindGroup;
  learned: number;
  total: number;
}

/** The group a kind of word is shown in: a phrasal verb is a verb. */
function groupOf(kind: PartOfSpeech | null): KindGroup {
  switch (kind) {
    case "phrasalVerb":
      return "verb";
    case null:
      return "other";
    default:
      return kind;
  }
}

/**
 * A chapter's words by the group of their kind, in the board's order and
 * only the groups it has: a phrasal verb counts as a verb, and a word of no
 * kind or nobody labelled as "other", so the groups add up to every word.
 */
export function kindTallies(counts: readonly KindCount[]): KindTally[] {
  const tallies: Map<KindGroup, KindTally> = new Map();
  for (const count of counts) {
    const group = groupOf(count.kind);
    const tally = tallies.get(group) ?? { group, learned: 0, total: 0 };
    tally.learned += count.learned;
    tally.total += count.total;
    tallies.set(group, tally);
  }
  return KIND_GROUPS.flatMap((group) => {
    const tally = tallies.get(group);
    return tally === undefined || tally.total === 0 ? [] : [tally];
  });
}
