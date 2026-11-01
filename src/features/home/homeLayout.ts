import { useSyncExternalStore } from "react";
import type { HomeState } from "@shared/domain";

export type TodayKind = "challenge" | "rotation" | "level";

/** What there is for today beside the conversation, the first one shown. */
export function todayLines(home: HomeState): TodayKind[] {
  const lines: TodayKind[] = [];
  if (home.activeChallenge !== null) {
    lines.push("challenge");
  }
  if (home.rotationSuggestion !== null) {
    lines.push("rotation");
  }
  if (home.levelSuggestion !== null) {
    lines.push("level");
  }
  return lines;
}

/** The `nav` breakpoint of `global.css`: both sides beside the centre. */
const WIDE = "(min-width: 62.5rem)";

function onWidthChange(listener: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

function isWide(): boolean {
  return window.matchMedia(WIDE).matches;
}

/**
 * For what a class cannot size: the orb is one element whichever the width, or
 * it would not travel, and it takes its glow from its `size`.
 */
export function useWideHome(): boolean {
  return useSyncExternalStore(onWidthChange, isWide);
}
