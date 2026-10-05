import type { StructureVerdict } from "@shared/structures";

/** How an answer went: what its colour says before its words do. */
export type Grade = "right" | "partial" | "wrong";

/** The grade of a verdict on a sentence, written or typed from the ear. */
export const VERDICT_GRADE: Record<StructureVerdict, Grade> = {
  correct: "right",
  partial: "partial",
  wrong: "wrong",
};

/**
 * The grade of a checked answer. A verdict is only right or not; the middle
 * is an answer that came out right on its second chance, after a hint or on
 * the item that follows a miss.
 */
export function grade(correct: boolean, helped: boolean): Grade {
  if (!correct) {
    return "wrong";
  }
  return helped ? "partial" : "right";
}
