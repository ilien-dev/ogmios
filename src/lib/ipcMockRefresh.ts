/**
 * The mock's refresh before reading: `src-tauri/src/commands/refresh.rs` in
 * small. One pass over the done words of a chapter that is ready to read,
 * most frequent first, each asked once, English → native. A right answer
 * changes nothing; a miss puts the word back in practice. A pass left
 * halfway is gone on with by the next refresh; a finished one is not. Every
 * step says how far the pass is: the words it has asked, out of those and
 * the ones left to ask.
 */
import type {
  BookWord,
  Refresh,
  RefreshAnswer,
  RefreshStep,
} from "@shared/domain";
import { READY } from "@shared/domain";
import { findMockChapter } from "./ipcMockBooks";
import { mockChapterWords, withMockReadiness } from "./ipcMockChapters";
import {
  PracticeError,
  answerMockRefresh,
  itemOf,
  small,
} from "./ipcMockPractice";

interface Pass {
  chapterId: string;
  /** The words it has asked, and the ones among them that were missed. */
  asked: Set<string>;
  missed: Set<string>;
  /** It ran out of words: the next refresh starts over. */
  finished: boolean;
}

let passes: Map<string, Pass> = new Map();
/** The latest pass of each chapter, by the chapter. */
let latest: Map<string, string> = new Map();

/** Forgets every pass. */
export function resetMockRefresh(): void {
  passes = new Map();
  latest = new Map();
}

/** The words the pass has yet to ask, most frequent first. */
function left(pass: Pass): BookWord[] {
  return mockChapterWords(pass.chapterId).filter(
    (word) => word.done && !word.known && !pass.asked.has(word.id),
  );
}

function stepOf(pass: Pass): RefreshStep {
  const rest = left(pass);
  const [word] = rest;
  const progress = {
    value: pass.asked.size,
    total: pass.asked.size + rest.length,
  };
  if (word !== undefined) {
    return { type: "item", item: itemOf(word, "recognition"), progress };
  }
  pass.finished = true;
  // A missed word practised back to done since is not back in practice.
  const reopened = mockChapterWords(pass.chapterId).filter(
    (each) => pass.missed.has(each.id) && !each.done && !each.known,
  );
  return {
    type: "summary",
    summary: {
      solid: pass.asked.size - pass.missed.size,
      reopened: reopened.length,
    },
    progress,
  };
}

/** The chapter's pass to go on with, or a new one. */
function start(chapterId: string): Refresh {
  const chapter = findMockChapter(chapterId);
  if (chapter === undefined) {
    throw new PracticeError("notFound", "chapter not found");
  }
  if (withMockReadiness(chapter).readiness !== READY) {
    throw new PracticeError("invalid", "this chapter is not ready to read");
  }
  const heldId = latest.get(chapterId) ?? "";
  const held = passes.get(heldId);
  if (held !== undefined && !held.finished) {
    if (left(held).length > 0) {
      return { id: heldId, step: stepOf(held) };
    }
    held.finished = true;
  }
  const id = `refresh-${String(passes.size + 1)}`;
  const pass = {
    chapterId,
    asked: new Set<string>(),
    missed: new Set<string>(),
    finished: false,
  };
  passes.set(id, pass);
  latest.set(chapterId, id);
  return { id, step: stepOf(pass) };
}

/** An empty answer is "I don't know": a miss like any other. */
function answer(
  sittingId: string,
  wordId: string,
  text: string,
): RefreshAnswer {
  const pass = passes.get(sittingId);
  if (pass === undefined) {
    throw new PracticeError("notFound", "sitting not found");
  }
  const word = left(pass).find((candidate) => candidate.id === wordId);
  if (word === undefined) {
    throw new PracticeError("invalid", "this word is not being asked");
  }
  const correct = answerMockRefresh(sittingId, word, text);
  pass.asked.add(wordId);
  if (!correct) {
    pass.missed.add(wordId);
  }
  return { correct, accepted: small(word.translations), step: stepOf(pass) };
}

function arg(args: unknown, key: string): string {
  return String((args as Record<string, unknown>)[key]);
}

type After = <T>(ms: number, value: () => T) => Promise<T>;

export function refreshCommands(
  after: After,
): Record<string, (args: unknown) => Promise<unknown>> {
  return {
    start_refresh: (args) => after(150, () => start(arg(args, "chapterId"))),
    answer_refresh: (args) =>
      after(80, () =>
        answer(
          arg(args, "sittingId"),
          arg(args, "wordId"),
          arg(args, "answer"),
        ),
      ),
  };
}
