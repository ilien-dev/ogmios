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
