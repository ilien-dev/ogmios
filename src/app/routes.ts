import type {
  DrillFormat,
  Report,
  SessionSetup,
  Translation,
  Ways,
} from "@shared/domain";

/** What is done with a chapter: each is a tab of the book's screen. */
export type BookTab = "words" | "listen" | "translate" | "write";

export const BOOK_TABS: readonly BookTab[] = [
  "words",
  "listen",
  "translate",
  "write",
];

/** What the learner has gathered: each is a tab of their own screen. */
export type MineTab = "words" | "patterns" | "structures" | "time";

export const MINE_TABS: readonly MineTab[] = [
  "words",
  "patterns",
  "structures",
  "time",
];

/** Every screen the app can show, with what it needs to render. */
export type Route =
  /** What comes back today, and where the learner left off. */
  | { name: "today" }
  /** The partner, today's topic and what came out of the conversations. */
  | { name: "home" }
  /** The book: its chapters, and the picked one's tab. */
  | { name: "book"; tab?: BookTab }
  | { name: "setup"; preset: Partial<SessionSetup> | null }
  | { name: "conversation"; setup: SessionSetup }
  | {
      name: "report";
      sessionId: string;
      report: Report | null;
      /** Straight after its conversation, or from the list of past ones. */
      origin: "session" | "past";
    }
  /** A round of drills: on that pattern, in that format, or as they come. */
  | {
      name: "practice";
      patternId: string | null;
      format: DrillFormat | null;
    }
  | {
      name: "books";
      /** The book a sitting is on; null shows the library. */
      bookId: string | null;
      chapterId?: string;
      /** A sitting on that chapter is running. */
      practising?: boolean;
      /** That sitting is the warm-up before reading. */
      refresh?: boolean;
      /** That sitting sorts the chapter's words into known and not. */
      triage?: boolean;
      /** That chapter is being translated: the attempt on the screen. */
      translating?: Translation;
    }
  /** A run of the daily review's words, in these ways. */
  | { name: "recall"; running: Ways }
  /** A session of written structures, by its id. */
  | { name: "structures"; running: string }
  | {
      name: "listening";
      /** The dictation on the screen, by its id. */
      running?: string;
      /** That chapter, read aloud. */
      reading?: string;
    }
  /** Everything the learner has: words, patterns, structures and time. */
  | { name: "progress"; tab?: MineTab }
  | { name: "settings" };

export type Navigate = (route: Route) => void;

/**
 * The screens that live beside the navigation rather than instead of it. An
 * activity takes the whole window, one thing at a time: a conversation, the
 * report straight after one, a round of drills, a sitting on a chapter, a
 * translation, a run of the daily review, a session of structures, a
 * dictation and a chapter read aloud.
 */
export function showsNav(route: Route): boolean {
  switch (route.name) {
    case "conversation":
    case "practice":
    case "recall":
    case "structures":
    case "listening":
      return false;
    case "books":
      return route.chapterId === undefined;
    case "report":
      return route.origin === "past";
    default:
      return true;
  }
}

/**
 * What tells one screen from another, so that only a move to a different one
 * animates. What a screen changes from the inside stays out: the tab of the
 * book or of what the learner has, and the preset of a setup.
 */
export function screenKey(route: Route): string {
  switch (route.name) {
    case "report":
      return JSON.stringify([route.name, route.sessionId]);
    case "practice":
      return JSON.stringify([route.name, route.patternId, route.format]);
    case "books":
      return JSON.stringify([
        route.name,
        route.bookId,
        route.chapterId ?? null,
        route.practising === true,
        route.refresh === true,
        route.triage === true,
        route.translating?.attemptId ?? null,
      ]);
    case "recall":
      return JSON.stringify([route.name, route.running]);
    case "structures":
      return JSON.stringify([route.name, route.running]);
    case "listening":
      return JSON.stringify([
        route.name,
        route.running ?? null,
        route.reading ?? null,
      ]);
    default:
      return route.name;
  }
}
