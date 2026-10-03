/**
 * Where the mock's book words stand: the ones the learner said they know,
 * and the ones finished in practice. A word is known by its base form, so in
 * every chapter at once; it is finished chapter by chapter, by its id.
 */

let known: Set<string> = new Set();
let done: Set<string> = new Set();

/** Forgets every known and every finished word. */
export function resetMockWords(): void {
  known = new Set();
  done = new Set();
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
