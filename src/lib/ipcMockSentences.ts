/**
 * The mock's side of the sentences a word is asked with
 * (`src-tauri/src/commands/sentences.rs`). The mock has no model to write
 * them, so its words are asked as their chapter has them: writing gives no
 * word a sentence, and no answer has a sentence to call bad.
 */
import { PracticeError } from "./ipcMockPractice";

type After = <T>(ms: number, value: () => T) => Promise<T>;

/** A preparation the test has not let finish yet, and how to let it. */
let held: { done: Promise<void>; release: () => void } | null = null;
/** Preparing the sentences fails with this, when it is set. */
let failure: string | null = null;

/**
 * Holds every preparation of the sentences until the function returned is
 * called: what waits for them can be seen waiting.
 */
export function holdMockSentences(): () => void {
  let release = (): void => undefined;
  const done: Promise<void> = new Promise((resolve) => {
    release = resolve;
  });
  held = { done, release };
  return () => {
    held = null;
    release();
  };
}

/** Preparing the sentences fails with this message; null to succeed. */
export function setMockSentencesFail(message: string | null): void {
  failure = message;
}

export function resetMockSentences(): void {
  held?.release();
  held = null;
  failure = null;
}

async function write(after: After): Promise<number> {
  await held?.done;
  return after(60, () => {
    if (failure !== null) {
      throw new PracticeError("provider", failure);
    }
    return 0;
  });
}

function refused(): never {
  throw new PracticeError("invalid", "this answer has no sentence");
}

export function sentenceCommands(
  after: After,
): Record<string, (args: unknown) => Promise<unknown>> {
  return {
    write_sentences: () => write(after),
    discard_sentence: () => after(60, refused),
    discard_recall_sentence: () => after(60, refused),
  };
}
