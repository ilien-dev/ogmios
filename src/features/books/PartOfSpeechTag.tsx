import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PartOfSpeech } from "@shared/domain";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

/**
 * The colour of each kind of word on its tag. A phrasal verb is a verb, told
 * from a plain one by its outline.
 */
export const TAG = {
  noun: "bg-noun-soft text-noun",
  verb: "bg-verb-soft text-verb",
  phrasalVerb: "bg-verb-soft text-verb ring-1 ring-verb ring-inset",
  adjective: "bg-adjective-soft text-adjective",
  adverb: "bg-adverb-soft text-adverb",
  expression: "bg-expression-soft text-expression",
} as const satisfies Record<Exclude<PartOfSpeech, "other">, string>;

/**
 * The same name as it stands on the band of the card a word is practised
 * on: in capitals, on the band's own colour, so only its letters show.
 */
const BAND =
  "rounded-md px-2 py-0.5 text-sm font-extrabold tracking-widest uppercase";

interface PartOfSpeechTagProps {
  /** Null for a word nobody labelled. */
  kind: PartOfSpeech | null;
  /** Set where the tag must not be a stop of its own on the way of Tab. */
  offTabPath?: boolean;
  /** Drawn as the band of a practice card names it, not as a tag. */
  band?: boolean;
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
  band = false,
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
        band
          ? BAND
          : `rounded-full px-2 py-0.5 text-xs font-medium ${TAG[kind]}`,
        className,
      )}
    >
      {t(`books.chapter.partOfSpeech.${kind}`)}
    </Tooltip>
  );
}
