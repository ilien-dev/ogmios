import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PartOfSpeech, VerbForm } from "@shared/domain";
import { cn } from "@/lib/cn";
import { PartOfSpeechTag } from "./PartOfSpeechTag";

/** A kind of word with a colour of its own, or none. */
type Tone = Exclude<PartOfSpeech, "other"> | "none";

/** The kind a card is coloured by: none for a word of no kind worth naming. */
export function toneOf(kind: PartOfSpeech | null): Tone {
  return kind === null || kind === "other" ? "none" : kind;
}

/**
 * The frame of the card in the colour of its kind of word. A phrasal verb is
 * a verb, told from a plain one by its dashed edge.
 */
export const FRAME = {
  noun: "border-noun",
  verb: "border-verb",
  phrasalVerb: "border-dashed border-verb",
  adjective: "border-adjective",
  adverb: "border-adverb",
  expression: "border-expression",
  none: "border-line-strong",
} as const satisfies Record<Tone, string>;

/** The band across the top of the card, in that colour, and its letters. */
const BAND = {
  noun: "bg-noun-soft text-noun",
  verb: "bg-verb-soft text-verb",
  phrasalVerb: "bg-verb-soft text-verb",
  adjective: "bg-adjective-soft text-adjective",
  adverb: "bg-adverb-soft text-adverb",
  expression: "bg-expression-soft text-expression",
  none: "bg-raised text-ink-soft",
} as const satisfies Record<Tone, string>;

/** The ring that points at the kind while a word climbs its steps. */
const RING = {
  noun: "ring-noun",
  verb: "ring-verb",
  phrasalVerb: "ring-verb",
  adjective: "ring-adjective",
  adverb: "ring-adverb",
  expression: "ring-expression",
  none: "ring-transparent",
} as const satisfies Record<Tone, string>;

interface PracticeBandProps {
  /** The language the word is shown in, and the one it is answered in. */
  from: string;
  to: string;
  kind: PartOfSpeech | null;
  /**
   * The word is on the steps that tell it from another sense: the kind is
   * what to look at, so it is ringed.
   */
  pointed: boolean;
}

/**
 * The band across the top of the card a word is practised on, in the colour
 * of its kind of word: which way it is asked on the left, the language
 * answered in brighter, and on the right what kind of word it is, the only
 * thing that tells one sense of a word from another.
 */
export function PracticeBand({
  from,
  to,
  kind,
  pointed,
}: PracticeBandProps): ReactNode {
  const shade = toneOf(kind);
  return (
    <div
      data-band
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3",
        BAND[shade],
      )}
    >
      <p
        data-way
        className="font-display text-lead font-bold whitespace-pre capitalize"
      >
        <span data-from className="opacity-70">
          {from}
        </span>
        {" → "}
        <span>{to}</span>
      </p>
      <PartOfSpeechTag
        kind={kind}
        band
        offTabPath
        className={cn(
          "ring-0 transition-shadow duration-300 ease-out-expo",
          RING[shade],
          pointed && "ring-2",
        )}
      />
    </div>
  );
}

/** The forms a verb is asked in, in the order a learner meets them. */
const FORMS = [
  "base",
  "present",
  "past",
  "pastParticiple",
  "ing",
] as const satisfies readonly VerbForm[];

/**
 * The forms of a verb on a row under the band, the one it is asked in filled
 * in the colour of a verb and the rest faint: all in one colour, since all
 * are a verb, and always in the same place, so the one asked is hard to miss.
 */
export function VerbForms({ form }: { form: VerbForm }): ReactNode {
  const { t } = useTranslation();
  return (
    <ol
      data-verb-forms
      className="flex flex-wrap gap-1 border-b border-line bg-sunken px-2.5 py-2"
    >
      {FORMS.map((each) => (
        <li
          key={each}
          aria-current={each === form ? "step" : undefined}
          data-verb-form={each === form ? each : undefined}
          className={cn(
            "flex-auto rounded-lg px-2 py-1.5 text-center text-xs whitespace-nowrap transition-colors duration-300 ease-out-expo",
            each === form
              ? "bg-verb font-extrabold text-on-kind"
              : "font-medium text-ink-faint",
          )}
        >
          {t(`books.sitting.verbForm.${each}`)}
        </li>
      ))}
    </ol>
  );
}
