import type { CorrectionCard, ReportCard } from "@shared/domain";

type CardOf<T extends ReportCard["type"]> = Extract<ReportCard, { type: T }>;

/**
 * One screen of the report. The two minor corrections share a screen (§7.3,
 * "short format"); the closing screen is the app's, not the backend's.
 */
export type Step =
  | { kind: "achievement"; card: CardOf<"achievement"> }
  | { kind: "focus"; card: CorrectionCard }
  | { kind: "minors"; cards: CorrectionCard[] }
  | { kind: "couldHaveSaid"; card: CardOf<"couldHaveSaid"> }
  | { kind: "vocabulary"; card: CardOf<"vocabulary"> }
  | { kind: "metrics"; card: CardOf<"metrics"> }
  | { kind: "challenge"; card: CardOf<"challenge"> }
  | { kind: "closing"; focusPatternId: string | null };

export function toSteps(cards: ReportCard[]): Step[] {
  const steps: Step[] = [];
  let focusPatternId: string | null = null;
  for (const card of cards) {
    if (card.type === "correction") {
      if (card.role === "focus") {
        focusPatternId = card.patternId;
        steps.push({ kind: "focus", card });
        continue;
      }
      const previous = steps.at(-1);
      if (previous?.kind === "minors") {
        previous.cards.push(card);
      } else {
        steps.push({ kind: "minors", cards: [card] });
      }
      continue;
    }
    steps.push({ kind: card.type, card } as Step);
  }
  // With no focus this session, practice goes to the first minor's pattern.
  const firstMinor = cards.find((card) => card.type === "correction");
  steps.push({
    kind: "closing",
    focusPatternId:
      focusPatternId ??
      (firstMinor?.type === "correction" ? firstMinor.patternId : null),
  });
  return steps;
}
