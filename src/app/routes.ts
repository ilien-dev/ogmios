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
  | { name: "progress" }
  | { name: "settings" };

export type Navigate = (route: Route) => void;

/**
 * The screens that live beside the navigation rather than instead of it. A
 * conversation, a report straight after one, and a running drill take the
 * whole window: one thing at a time.
 */
export function showsNav(route: Route): boolean {
  if (route.name === "conversation") {
    return false;
  }
  if (route.name === "practice") {
    return !route.autostart;
  }
  return route.name !== "report" || route.origin === "progress";
}
