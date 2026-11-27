import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KnownWord } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { STAGGER_LIMIT } from "@/lib/motion";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { forgetKnownWord, listKnownWords } from "@/lib/ipc";

interface KnownWordsProps {
  /** Inside a sheet: no card of its own, and its heading names the sheet. */
  sheet?: { headingId: string };
  /** How many there are, each time that changes. */
  onCount?: (count: number) => void;
}

/**
 * Every word the learner said they know, from any chapter of any book, the
 * latest first. Any of them can be taken back, which puts it in practice
 * again wherever a chapter has it.
 */
export function KnownWords({ sheet, onCount }: KnownWordsProps): ReactNode {
  const { t } = useTranslation();
  const [words, setWords] = useState<KnownWord[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listKnownWords()
      .then((loaded) => {
        if (live) {
          setWords(loaded);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (words !== null) {
      onCount?.(words.length);
    }
  }, [words, onCount]);

  const undo = async (word: KnownWord): Promise<void> => {
    setFailure(null);
    try {
      setWords(await forgetKnownWord(word.id));
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <Reveal
      as="section"
      aria-label={t("books.known.title")}
      className={cn(
        "flex flex-col gap-5",
        sheet === undefined && "rounded-xl glass p-6",
      )}
    >
      <header
        className={cn("flex flex-col gap-2", sheet !== undefined && "pr-12")}
      >
        <h2
          id={sheet?.headingId}
          className="font-display text-2xl font-light tracking-tight text-ink"
        >
          {t("books.known.title")}
        </h2>
        <p className="text-sm text-ink-soft">{t("books.known.intro")}</p>
      </header>
      <div className="relative flex flex-col gap-4">
        <Presence>
          {failure !== null && (
            <Reveal key="failure">
              <Notice tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            </Reveal>
          )}
          {words === null && failure === null && (
            <Reveal key="loading" kind="fade">
              <Spinner />
            </Reveal>
          )}
          {words?.length === 0 && (
            <Reveal key="empty" as="p" kind="fade" className="text-ink-soft">
              {t("books.known.empty")}
            </Reveal>
          )}
          {words !== null && words.length > 0 && (
            <Reveal
              key="words"
              as="section"
              index={1}
              className="flex flex-col gap-4"
            >
              <h3 className="font-mono text-xs font-medium text-ink-faint">
                {t("books.chapter.knownCount", { count: words.length })}
              </h3>
              <ul className="flex flex-col divide-y divide-line">
                <Presence>
                  {words.map((word, index) => (
                    <Reveal
                      key={word.id}
                      as="li"
                      kind="fade"
                      index={index}
                      layout={index < STAGGER_LIMIT ? "position" : false}
                      className="flex items-center gap-4 py-2"
                    >
                      <span className="font-medium text-ink">
                        {word.lemma}
                        <SpeakButton text={word.lemma} className="ml-1" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-soft">
                        {word.translations.join(", ")}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("books.chapter.undoWord", {
                          word: word.lemma,
                        })}
                        onClick={() => void undo(word)}
                      >
                        {t("books.chapter.undo")}
                      </Button>
                    </Reveal>
                  ))}
                </Presence>
              </ul>
            </Reveal>
          )}
        </Presence>
      </div>
    </Reveal>
  );
}
