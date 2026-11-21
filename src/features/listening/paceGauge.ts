import type { PaceStanding } from "@shared/listening";

/**
 * How much of what was said at a pace the learner heard, as a whole percent
 * rounded down; null for a pace never tried.
 */
export function heardShare(standing: PaceStanding): number | null {
  if (standing.sentences === 0) {
    return null;
  }
  if (standing.total === 0) {
    return 0;
  }
  return Math.floor((standing.right * 100) / standing.total);
}
