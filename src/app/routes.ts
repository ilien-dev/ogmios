import type { DrillFormat, Report, SessionSetup, Ways } from "@shared/domain";

/** Every screen the app can show, with what it needs to render. */
export type Route =
  | { name: "home" }
  | { name: "setup"; preset: Partial<SessionSetup> | null }
  | { name: "conversation"; setup: SessionSetup }
  | {
      name: "report";
      sessionId: string;
      report: Report | null;
      origin: "session" | "progress";
    }
  | {
      name: "practice";
      patternId: string | null;
      format: DrillFormat | null;
      autostart: boolean;
    }
  | {
      name: "books";
      bookId: string | null;
      chapterId?: string;
      /** Instead of the shelf: every word the learner already knows. */
      known?: boolean;
      /** A sitting on that chapter is running. */
      practising?: boolean;
      /** That sitting is the quick refresh before reading. */
      refresh?: boolean;
      /** That sitting sorts the chapter's words into known and not. */
      triage?: boolean;
      /** Instead of the chapter's words: translating it. */
      translating?: boolean;
    }
  | {
      name: "recall";
      /** A run of the recall in these ways is on the screen. */
      running?: Ways;
    }
  | {
      name: "structures";
      /** The session on the screen, by its id. */
      running?: string;
      /** Instead of the menu: the structures of that chapter. */
      chapterId?: string;
      /** The book that chapter was opened from: where "back" returns. */
      bookId?: string;
    }
  | {
      name: "listening";
      /** The dictation on the screen, by its id. */
      running?: string;
      /** Instead of the menu: that chapter, read aloud. */
      reading?: string;
      /** The chapter the menu is on; the one opened last without it. */
      chapterId?: string;
    }
  | { name: "progress" }
  | { name: "settings" };

export type Navigate = (route: Route) => void;

/**
 * The screens that live beside the navigation rather than instead of it. A
 * conversation, a report straight after one, a running drill, a sitting on a
 * chapter, a run of the recall, a session of structures and a dictation
 * take the whole window: one thing at a time.
 */
export function showsNav(route: Route): boolean {
  if (route.name === "conversation") {
    return false;
  }
  if (route.name === "practice") {
    return !route.autostart;
  }
  if (route.name === "books") {
    return route.practising !== true;
  }
  if (
    route.name === "recall" ||
    route.name === "structures" ||
    route.name === "listening"
  ) {
    return route.running === undefined;
  }
  return route.name !== "report" || route.origin === "progress";
}
