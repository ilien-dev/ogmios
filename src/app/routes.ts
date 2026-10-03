import type { DrillFormat, Report, SessionSetup } from "@shared/domain";

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
    }
  | { name: "progress" }
  | { name: "settings" };

export type Navigate = (route: Route) => void;

/**
 * The screens that live beside the navigation rather than instead of it. A
 * conversation, a report straight after one, a running drill and a sitting
 * on a chapter take the whole window: one thing at a time.
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
  return route.name !== "report" || route.origin === "progress";
}
