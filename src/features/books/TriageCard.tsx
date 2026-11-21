import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BookWord } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Button } from "@/components/ui/Button";
import { VerbFormTag } from "./VerbFormTag";

interface TriageCardProps {
  word: BookWord;
  /** Where the card stands in the list: "3 / 40". */
  position: string;
}

/**
 * One word of the list being sorted: the word as the book writes it, its
 * translations in that same form, and, of a verb the book has in another
 * form than its base form, which form that is. The book's sentence stays
 * folded under it until it is asked for: most words need no more than a
 * glance.
 */
export function TriageCard({ word, position }: TriageCardProps): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sentenceId = useId();
  const form = word.verbForm === "base" ? null : word.verbForm;
  const shown = word.translations.join(", ");
  return (
    <>
      <p className="font-mono text-xs text-ink-faint tabular-nums">
        {position}
      </p>
      <div className="flex flex-col items-center gap-2">
        <Presence>
          {form !== null && (
            <Reveal key={form} as="span" kind="fade">
              <VerbFormTag form={form} />
            </Reveal>
          )}
        </Presence>
        <h1 className="font-display text-5xl font-semibold tracking-tight wrap-anywhere text-ink">
          {word.lemma}
        </h1>
      </div>
      <p className="text-lead text-ink-soft">
        <Swap id={shown}>{shown}</Swap>
      </p>
      <p className="text-sm text-ink-faint">
        {t("books.triage.times", { count: word.count })}
      </p>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={sentenceId}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <Swap id={open ? "hide" : "show"}>
          {t(open ? "books.triage.hideBook" : "books.triage.inBook")}
        </Swap>
      </Button>
      <div id={sentenceId} className="w-full">
        <Presence>
          {open && (
            <Reveal
              key="sentence"
              as="p"
              kind="rise"
              className="text-sm text-ink-soft"
            >
              {word.sentence}
            </Reveal>
          )}
        </Presence>
      </div>
    </>
  );
}
