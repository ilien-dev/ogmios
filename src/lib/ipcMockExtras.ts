/** The mock's commands that are kept in files of their own. */
import { structureCommands } from "./ipcMockStructures";
import type { Progress } from "@shared/domain";
import { bookCommands } from "./ipcMockBooks";
import {
  chapterCommands,
  mockLearnedWords,
  withMockReadiness,
} from "./ipcMockChapters";
import { listeningCommands } from "./ipcMockListening";
import { practiceCommands } from "./ipcMockPractice";
import { recallCommands } from "./ipcMockRecall";
import { refreshCommands } from "./ipcMockRefresh";
import { sentenceCommands } from "./ipcMockSentences";
import { speechCommands } from "./ipcMockSpeech";
import { translateCommands } from "./ipcMockTranslate";
import { updateCommands } from "./ipcMockUpdate";

type After = <T>(ms: number, value: () => T) => Promise<T>;
type Emit = (event: string, payload: unknown) => void;

/** The conversations deleted since the last reset. */
let deleted: Set<string> = new Set();

export function resetMockDeleted(): void {
  deleted = new Set();
}

/**
 * The progress map as the screen gets it: with the book words finished in
 * practice, newest first, and without the conversations deleted.
 */
export function shownProgress(progress: Progress): Progress {
  const [date = ""] = new Date().toISOString().split("T");
  const learned = mockLearnedWords().map((word) => ({
    asked: word.translations[0] ?? null,
    english: word.lemma,
    date,
    strength: word.strength,
  }));
  return {
    ...progress,
    vocabulary: [...learned, ...progress.vocabulary],
    sessions: progress.sessions.filter((kept) => !deleted.has(kept.id)),
  };
}

export function extraCommands(
  after: After,
  emit: Emit,
): Record<string, (args: unknown) => Promise<unknown>> {
  return {
    dispute_item: () => after(150, () => null),
    delete_session_audio: () => after(300, () => null),
    delete_session: (args) =>
      after(200, () => {
        deleted.add((args as { sessionId: string }).sessionId);
        return null;
      }),
    ...updateCommands(after, emit),
    ...bookCommands(after, withMockReadiness),
    ...chapterCommands(after, emit),
    ...practiceCommands(after),
    ...refreshCommands(after),
    ...recallCommands(after),
    ...sentenceCommands(after),
    ...translateCommands(after),
    ...structureCommands(after, emit),
    ...listeningCommands(after, emit),
    ...speechCommands(after, emit),
  };
}
