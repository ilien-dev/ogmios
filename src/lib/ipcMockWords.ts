/**
 * Where the mock's book words stand: the ones the learner said they know,
 * the ones finished in practice, and the ones finished one way alone. A word
 * is known by its base form, so in every chapter at once; it is finished
 * chapter by chapter, by its id. A learned word also stands on a step of
 * the daily recall, by its base form, and that says how strong it is.
 */
import type { Direction, Strength } from "@shared/domain";

/** The step a word is settling from, and the one it is firm from. */
const SETTLING_STEP = 1;
const FIRM_STEP = 4;

let known: Set<string> = new Set();
let done: Set<string> = new Set();
let halves: Map<string, Direction> = new Map();
let steps: Map<string, number> = new Map();
let misses: Map<string, number> = new Map();

/** Forgets every known and every finished word. */
export function resetMockWords(): void {
  known = new Set();
  done = new Set();
  halves = new Map();
  steps = new Map();
  misses = new Map();
}

/** The step of the recall a learned word is on; the first until answered. */
export function mockWordStep(lemma: string): number {
  return steps.get(lemma) ?? 0;
}

export function setMockWordStep(lemma: string, step: number): void {
  steps.set(lemma, step);
}

/** How strong a learned word is, by its step. */
export function mockWordStrength(lemma: string): Strength {
  const step = mockWordStep(lemma);
  if (step >= FIRM_STEP) {
    return "firm";
  }
  return step >= SETTLING_STEP ? "settling" : "new";
}

/** Misses of a word in the recall. */
export function mockWordMisses(lemma: string): number {
  return misses.get(lemma) ?? 0;
}

export function addMockWordMiss(lemma: string): void {
  misses.set(lemma, mockWordMisses(lemma) + 1);
}

/** Keeps the one direction a chapter's word is finished in, or none. */
export function setMockWordHalf(wordId: string, half: Direction | null): void {
  if (half === null) {
    halves.delete(wordId);
  } else {
    halves.set(wordId, half);
  }
}

export function mockWordHalf(wordId: string): Direction | null {
  return halves.get(wordId) ?? null;
}

/** Marks a base form as known already, or takes that back. */
export function setMockWordKnown(lemma: string, isKnown: boolean): void {
  if (isKnown) {
    known.add(lemma);
  } else {
    known.delete(lemma);
  }
}

export function isMockWordKnown(lemma: string): boolean {
  return known.has(lemma);
}

/** Every known base form, the one marked last first. */
export function mockKnownLemmas(): string[] {
  return [...known].reverse();
}

/**
 * Marks one chapter's word as finished in both directions, or, after a miss
 * in the refresh, as back in practice.
 */
export function setMockWordDone(wordId: string, isDone = true): void {
  if (isDone) {
    done.add(wordId);
  } else {
    done.delete(wordId);
  }
}

export function isMockWordDone(wordId: string): boolean {
  return done.has(wordId);
}
