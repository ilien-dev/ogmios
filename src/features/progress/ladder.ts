import type { PatternState, PatternView, WeekMinutes } from "@shared/domain";
import type { Tone } from "@/components/scene/Relief";

/**
 * The share of right uses a pattern needs before it can be mastered: one of
 * the conditions `MASTERED_RATE` sets in `src-tauri/src/memory/mod.rs`, shown
 * here as the line to reach.
 */
export const MASTERY_RATE = 0.8;

/** The four steps of the staircase, from noticed to mastered. */
export const STEPS = ["detected", "focus", "improving", "mastered"] as const;

const STEP: Record<PatternState, number> = {
  detected: 0,
  focus: 1,
  // Slipped back is worked on again: it stands with the focus.
  relapse: 1,
  improving: 2,
  mastered: 3,
};

/** Which step a state stands on. */
export function stepOf(state: PatternState): number {
  return STEP[state];
}

/** How many steps are left before mastered. */
export function stepsLeft(state: PatternState): number {
  return STEPS.length - 1 - STEP[state];
}

/** The colour of a pattern on the staircase and on its card. */
export const TONE: Record<PatternState, Tone> = {
  detected: "quiet",
  focus: "focus",
  relapse: "wrong",
  improving: "correct",
  mastered: "correct",
};

/** Active work first, then what is waiting, then what is done. */
const WORK: PatternState[] = [
  "relapse",
  "focus",
  "improving",
  "detected",
  "mastered",
];

export function byWork(patterns: readonly PatternView[]): PatternView[] {
  return [...patterns].sort(
    (a, b) => WORK.indexOf(a.state) - WORK.indexOf(b.state),
  );
}

/** Up the staircase: noticed first, mastered last. */
export function byLadder(patterns: readonly PatternView[]): PatternView[] {
  return [...patterns].sort((a, b) => STEP[a.state] - STEP[b.state]);
}

/** The pattern being worked on: in focus, else slipped back. */
export function focusPattern(
  patterns: readonly PatternView[],
): PatternView | null {
  return (
    patterns.find((pattern) => pattern.state === "focus") ??
    patterns.find((pattern) => pattern.state === "relapse") ??
    null
  );
}

/** The mean share of right uses over the patterns that have any. */
export function meanRate(patterns: readonly PatternView[]): number | null {
  const rates = patterns
    .map((pattern) => pattern.correctRate)
    .filter((rate) => rate !== null);
  return rates.length === 0
    ? null
    : rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
}

export interface WeekDelta extends WeekMinutes {
  /** Minutes more (or fewer) than the week before, when it is known. */
  delta: number | null;
}

/** The last weeks, each with its change from the one before. */
export function weekDeltas(
  weeks: readonly WeekMinutes[],
  shown = 4,
): WeekDelta[] {
  const from = Math.max(0, weeks.length - shown);
  return weeks.slice(from).map((week, at) => {
    const before = weeks[from + at - 1];
    return {
      ...week,
      delta:
        before === undefined
          ? null
          : Math.round(week.minutes) - Math.round(before.minutes),
    };
  });
}

/** The mean minutes a week. */
export function weekAverage(weeks: readonly WeekMinutes[]): number {
  return weeks.length === 0
    ? 0
    : weeks.reduce((sum, week) => sum + week.minutes, 0) / weeks.length;
}
