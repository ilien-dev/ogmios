/**
 * The mock's side of the sentences a word is asked with
 * (`src-tauri/src/commands/sentences.rs`). The mock has no model to write
 * them, so its words are asked as their chapter has them: writing gives no
 * word a sentence, and no answer has a sentence to call bad.
 */
import { PracticeError } from "./ipcMockPractice";

type After = <T>(ms: number, value: () => T) => Promise<T>;

function refused(): never {
  throw new PracticeError("invalid", "this answer has no sentence");
}

export function sentenceCommands(
  after: After,
): Record<string, (args: unknown) => Promise<unknown>> {
  return {
    write_sentences: () => after(60, () => 0),
    discard_sentence: () => after(60, refused),
    discard_recall_sentence: () => after(60, refused),
  };
}
