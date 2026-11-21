import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ShownSentence, WordHint } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { Context } from "./SentenceContext";

interface ClueProps {
  clue: WordHint;
  /** The word is the answer: its sentence comes with a blank. */
  blanked: boolean;
}

/**
 * The hint the learner asked for: the sentence the word came without, and,
 * from the next one on, the answer letter by letter, a mark for each one
 * not given yet.
 */
export function Clue({ clue, blanked }: ClueProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Reveal data-hint className="flex flex-col gap-2">
      <Presence>
        {clue.context !== null && (
          <Reveal key="context">
            <Context parts={clue.context} blanked={blanked} />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {clue.mask !== null && (
          <Reveal key="mask" as="p" className="text-ink-soft">
            <span className="sr-only">{t("books.sitting.hintIs")} </span>
            <span
              data-mask
              className="font-mono text-lead tracking-widest whitespace-pre text-ink"
            >
              {clue.mask}
            </span>
          </Reveal>
        )}
      </Presence>
    </Reveal>
  );
}

interface WholeProps {
  sentence: ShownSentence;
  /** Calls the sentence bad; null where that is not offered. */
  onBad: (() => void) | null;
  busy: boolean;
}

/**
 * The sentence a word was asked with, once it is answered: whole, to read
 * and to hear, with what it says in the learner's language and where it is
 * from. A sentence that is wrong or odd can be called bad: it is never
 * asked with again, and the answer given to it does not count.
 */
export function Whole({ sentence, onBad, busy }: WholeProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col gap-1 border-l-2 border-line pl-4 text-left">
      <p className="text-lead text-ink">
        {sentence.text}
        <SpeakButton text={sentence.text} className="ml-1" />
      </p>
      <p className="text-ink-soft">{sentence.translation}</p>
      <p className="flex items-center gap-3 text-sm text-ink-faint">
        {sentence.book
          ? t("books.sitting.fromBook")
          : t("books.sitting.fromClaude")}
        <Presence>
          {onBad !== null && (
            <Reveal key="onBad" as="span" kind="fade">
              <button
                type="button"
                disabled={busy}
                onClick={onBad}
                className="rounded-sm underline-offset-4 transition-control hover:text-ink hover:underline"
              >
                {t("books.sitting.badSentence")}
              </button>
            </Reveal>
          )}
        </Presence>
      </p>
    </div>
  );
}
