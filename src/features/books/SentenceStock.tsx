import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SentenceProgress } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";

interface SentenceStockProps {
  /** The sentences are being prepared: this shows while they are. */
  readying: boolean;
  /** How far they stand, once the preparation says. */
  writing: SentenceProgress | null;
}

/**
 * What waits for the words' sentences says how many words have them
 * already, and how many sentences those have, over a bar of the words.
 * Until the preparation says, it says only that it is preparing them.
 */
export function SentenceStock({
  readying,
  writing,
}: SentenceStockProps): ReactNode {
  const { t } = useTranslation();
  const counted = writing !== null && writing.words > 0;
  return (
    <Presence>
      {readying && (
        <Reveal
          key="readying"
          aria-live="polite"
          className="flex w-full max-w-72 flex-col gap-2"
        >
          <p className="flex items-center gap-2 text-sm text-ink-soft tabular-nums">
            <Spinner />
            {counted
              ? t("books.sentences.stock", {
                  ready: writing.ready,
                  words: writing.words,
                  count: writing.sentences,
                })
              : t("books.sentences.readying")}
          </p>
          <Presence>
            {counted && (
              <Reveal key="bar" kind="fade">
                <ProgressBar
                  label={t("books.sentences.bar")}
                  value={writing.ready}
                  total={writing.words}
                  tone="book"
                />
              </Reveal>
            )}
          </Presence>
        </Reveal>
      )}
    </Presence>
  );
}
