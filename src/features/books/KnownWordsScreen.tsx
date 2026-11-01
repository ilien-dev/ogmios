import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KnownWord } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { errorMessage } from "@/lib/errors";
import { forgetKnownWord, listKnownWords } from "@/lib/ipc";

interface KnownWordsScreenProps {
  onBack: () => void;
}

/**
 * Every word the learner said they know, from any chapter of any book, the
 * latest first. Any of them can be taken back, which puts it in practice
 * again wherever a chapter has it.
 */
export function KnownWordsScreen({ onBack }: KnownWordsScreenProps): ReactNode {
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

  const undo = async (word: KnownWord): Promise<void> => {
    setFailure(null);
    try {
      setWords(await forgetKnownWord(word.key));
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-12 nav:py-16">
        <Reveal as="header" index={0} className="flex flex-col gap-3">
          <BackLink label={t("books.title")} onClick={onBack} />
          <h1 className="font-display text-display font-light text-ink">
            {t("books.known.title")}
          </h1>
          <p className="text-lead text-ink-soft">{t("books.known.intro")}</p>
        </Reveal>

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
              <h2 className="text-sm font-medium text-ink-faint">
                {t("books.chapter.knownCount", { count: words.length })}
              </h2>
              <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface px-4 py-2 shadow-card">
                <Presence>
                  {words.map((word, index) => (
                    <Reveal
                      key={word.key}
                      as="li"
                      kind="fade"
                      index={index}
                      layout="position"
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
    </main>
  );
}
