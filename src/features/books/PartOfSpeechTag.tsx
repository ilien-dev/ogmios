import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PartOfSpeech } from "@shared/domain";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

/**
 * The colour of each kind of word on its tag. A phrasal verb is a verb; an
 * expression is no kind of single word and stays neutral.
 */
export const TAG = {
  noun: "bg-noun-soft text-noun",
  verb: "bg-verb-soft text-verb",
  phrasalVerb: "bg-verb-soft text-verb",
  adjective: "bg-adjective-soft text-adjective",
  adverb: "bg-adverb-soft text-adverb",
  expression: "bg-raised text-ink-soft",
} as const satisfies Record<Exclude<PartOfSpeech, "other">, string>;

interface PartOfSpeechTagProps {
  /** Null for a word nobody labelled. */
  kind: PartOfSpeech | null;
  /** Set where the tag must not be a stop of its own on the way of Tab. */
  offTabPath?: boolean;
  className?: string;
}

/**
 * What kind of word a word is, on a small tag of its own colour that says in
 * a few words what that kind is when asked. A word nobody labelled, or of no
 * kind worth naming, has none.
 */
export function PartOfSpeechTag({
  kind,
  offTabPath = false,
  className,
}: PartOfSpeechTagProps): ReactNode {
  const { t } = useTranslation();
  if (kind === null || kind === "other") {
    return null;
  }
  return (
    <Tooltip
      hint={t(`books.chapter.partOfSpeechHint.${kind}`)}
      data-part-of-speech={kind}
      tabIndex={offTabPath ? -1 : undefined}
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        TAG[kind],
        className,
      )}
    >
      {t(`books.chapter.partOfSpeech.${kind}`)}
    </Tooltip>
  );
}
