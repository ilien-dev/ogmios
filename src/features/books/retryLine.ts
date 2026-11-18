import type { TFunction } from "i18next";
import type { KindReminder, VerbForm } from "@shared/domain";

/**
 * What says why an answer is none yet: another word for what was shown, the
 * the word in a form its sentence does not have, or, asked on its own, in a form
 * that is not the one asked for: for the English word, the form its
 * translation was shown in; for a translation, the form of a verb the book
 * has in another form than its base form ("juró" for "swore"), and the base
 * form of any other.
 */
export function retryKey(
  other: boolean,
  inSentence: boolean,
  toEnglish: boolean,
  verbForm: VerbForm | null = null,
):
  | "books.sitting.otherWord"
  | "books.sitting.wrongForm"
  | "books.sitting.askedForm"
  | "books.sitting.baseForm" {
  if (other) {
    return "books.sitting.otherWord";
  }
  if (inSentence) {
    return "books.sitting.wrongForm";
  }
  const inflected = verbForm !== null && verbForm !== "base";
  return toEnglish || inflected
    ? "books.sitting.askedForm"
    : "books.sitting.baseForm";
}

/**
 * What reminds the learner of the kind of word asked for, when they gave a
 * word of another kind from its root ("patada" for "kicked"): both kinds,
 * the form a verb is asked in, and in a few words what the kind asked for
 * is. Null when either is no
 * kind worth naming: the line for the wrong form says it then.
 */
export function kindLine(
  kind: KindReminder | null,
  t: TFunction,
  verbForm: VerbForm | null = null,
): string | null {
  const asked = kind?.asked ?? "other";
  const given = kind?.given ?? "other";
  if (asked === "other" || given === "other") {
    return null;
  }
  const name = t(`books.chapter.partOfSpeech.${asked}`);
  const meaning = t(`books.chapter.partOfSpeechHint.${asked}`);
  // A verb is asked for in a form too: "verbo (pasado simple)".
  const form =
    verbForm === null || verbForm === "base"
      ? ""
      : ` (${t(`books.sitting.verbForm.${verbForm}`)})`;
  return t("books.sitting.otherKind", {
    asked: name,
    form,
    given: t(`books.chapter.partOfSpeech.${given}`),
    title: name.charAt(0).toUpperCase() + name.slice(1),
    meaning: meaning.charAt(0).toLowerCase() + meaning.slice(1),
  });
}
