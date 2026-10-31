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
      /** Instead of the section's own screen: every structure, to pick from. */
      catalog?: boolean;
      /** Instead of the menu: the structures of that chapter. */
      chapterId?: string;
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
 * The chapter the learner is on: the one on the screen, or else the one the
 * backend says was opened last. The backend learns of a chapter only once its
 * screen has loaded, too late for what is read at the move that opens it.
 */
export function chapterOn(route: Route, opened: string | null): string | null {
  return route.name === "books" && route.chapterId !== undefined
    ? route.chapterId
    : opened;
}

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

/** The two things the app is for. */
export type Section = "conversation" | "book";

/** The section a screen is under; Home and Settings stand outside both. */
export function sectionOf(route: Route): Section | null {
  switch (route.name) {
    case "home":
    case "settings":
      return null;
    case "books":
    case "recall":
    case "structures":
    case "listening":
      return "book";
    default:
      return "conversation";
  }
}

/**
 * What tells one screen from another, so that only a move to a different one
 * animates. What a screen changes from the inside stays out, such as the
 * chapter picked on the listening menu or the preset of a setup.
 */
export function screenKey(route: Route): string {
  switch (route.name) {
    case "report":
      return JSON.stringify([route.name, route.sessionId]);
    case "practice":
      return JSON.stringify([
        route.name,
        route.patternId,
        route.format,
        route.autostart,
      ]);
    case "books":
      return JSON.stringify([
        route.name,
        route.bookId,
        route.chapterId ?? null,
        route.known === true,
        route.practising === true,
        route.refresh === true,
        route.triage === true,
        route.translating === true,
      ]);
    case "recall":
      return JSON.stringify([route.name, route.running ?? null]);
    case "structures":
      return JSON.stringify([
        route.name,
        route.running ?? null,
        route.chapterId ?? null,
        route.catalog === true,
      ]);
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
