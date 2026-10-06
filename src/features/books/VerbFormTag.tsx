import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { VerbForm } from "@shared/domain";

interface VerbFormTagProps {
  /** Null for a word that is no verb, or whose sentence nobody labelled. */
  form: VerbForm | null;
}

/**
 * The form a verb has in the sentence it is asked with, on a small tag
 * beside the kind of word it is: the form its answer is asked in.
 */
export function VerbFormTag({ form }: VerbFormTagProps): ReactNode {
  const { t } = useTranslation();
  if (form === null) {
    return null;
  }
  return (
    <span
      data-verb-form={form}
      className="rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-ink-soft"
    >
      {t(`books.sitting.verbForm.${form}`)}
    </span>
  );
}
