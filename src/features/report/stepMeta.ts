import type { TFunction } from "i18next";
import type { Step } from "./steps";

/** The colour a step's tag takes, on the board and over the scene. */
export type StepTone =
  "accent" | "correct" | "wrong" | "partner" | "book" | "partial" | "ink";

export const TONE_TAG: Record<StepTone, string> = {
  accent: "border-accent/35 bg-accent-soft text-accent-text",
  correct: "border-correct/30 bg-correct-soft text-correct",
  wrong: "border-wrong/35 bg-wrong-soft text-wrong",
  partner: "border-partner-line bg-partner-soft text-partner",
  book: "border-book/30 bg-book-soft text-book",
  partial: "border-partial/30 bg-partial-soft text-partial",
  ink: "border-line bg-sunken text-ink-soft",
};

const TONE: Record<Step["kind"], StepTone> = {
  achievement: "correct",
  focus: "accent",
  minors: "wrong",
  couldHaveSaid: "partner",
  nativeRewrite: "partner",
  vocabulary: "book",
  metrics: "ink",
  challenge: "partial",
  closing: "accent",
};

export function stepTone(step: Step): StepTone {
  return TONE[step.kind];
}

/** The heading of a step's card. */
export function stepTitle(step: Step, t: TFunction): string {
  switch (step.kind) {
    case "achievement":
      return t("report.achievement.title");
    case "focus":
      return t("report.focus.title");
    case "minors":
      return t("report.minor.title", { count: step.cards.length });
    case "couldHaveSaid":
      return t("report.couldHaveSaid.title");
    case "nativeRewrite":
      return t("report.nativeRewrite.title");
    case "vocabulary":
      return t("report.vocabulary.title");
    case "metrics":
      return t("report.metrics.title");
    case "challenge":
      return t("report.challenge.title");
    case "closing":
      return t("report.closing.title");
    default:
      return "";
  }
}

/** The short tag of a step: what kind of card it is. */
export function stepTag(step: Step, t: TFunction): string {
  switch (step.kind) {
    case "achievement":
      return step.card.bestSentence === null
        ? t("report.board.tag.achievement")
        : t("report.achievement.best");
    case "minors":
      return t("report.board.tag.minor");
    default:
      return t(`report.board.tag.${step.kind}`);
  }
}
