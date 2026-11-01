import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type {
  Translation,
  TranslationAttempts,
  TranslationDirection,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/errors";
import {
  closeAttempt,
  deleteAttempt,
  getAttempt,
  listAttempts,
  startAttempt,
} from "@/lib/ipc";
import { AttemptRow } from "./AttemptRow";

const DIRECTIONS: readonly TranslationDirection[] = ["toNative", "toEnglish"];

interface TranslateStartProps {
  chapterId: string;
  /** The learner's language, as the interface names it. */
  native: string;
  /** An attempt was started, or one of the list opened. */
  onOpen: (attempt: Translation) => void;
}

/**
 * Where a session begins: a new attempt in one direction, chosen here and
 * not inside it, or one of the attempts kept. A paused one is gone on with
 * or finished as it is; a finished one is read. Back into English is open
 * once a paragraph is whole the other way.
 */
export function TranslateStart({
  chapterId,
  native,
  onOpen,
}: TranslateStartProps): ReactNode {
  const { t } = useTranslation();
  const [found, setFound] = useState<TranslationAttempts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setFound(await listAttempts(chapterId));
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }, [chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one step that ends on an attempt to open, or on the list again. */
  const run = async (
    step: () => Promise<Translation | null>,
  ): Promise<void> => {
    setFailure(null);
    try {
      const attempt = await step();
      if (attempt === null) {
        await load();
      } else {
        onOpen(attempt);
      }
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <div className="relative">
      <Presence swap>
        {found === null ? (
          <Reveal key="loading" kind="fade">
            <Presence swap>
              {failure === null ? (
                <Reveal key="waiting" as="span" kind="fade">
                  <Spinner />
                </Reveal>
              ) : (
                <Notice key="failure" tone="danger">
                  {t("common.error", { message: failure })}
                </Notice>
              )}
            </Presence>
          </Reveal>
        ) : (
          <Reveal key="start" kind="fade">
            <Stagger className="flex flex-col gap-10">
              <Presence>
                {failure !== null && (
                  <Notice key="failure" tone="danger">
                    {t("common.error", { message: failure })}
                  </Notice>
                )}
              </Presence>
              <Reveal as="section" className="flex flex-col gap-4">
                <p className="text-ink-soft">{t("books.translate.choose")}</p>
                <Stagger as="ul" className="flex flex-col gap-3">
                  {DIRECTIONS.map((direction) => {
                    const closed =
                      direction === "toEnglish" && found.back === 0;
                    return (
                      <Reveal as="li" key={direction}>
                        <button
                          type="button"
                          disabled={closed}
                          onClick={() =>
                            void run(() => startAttempt(chapterId, direction))
                          }
                          className="group flex w-full items-center gap-4 rounded-xl bg-surface px-5 py-4 text-left shadow-card transition-control hover:shadow-float disabled:cursor-not-allowed disabled:shadow-none"
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="font-medium text-ink group-disabled:text-ink-faint">
                              {t(`books.translate.${direction}.name`, {
                                language: native,
                              })}
                            </span>
                            <span className="text-sm text-ink-soft">
                              {closed
                                ? t("books.translate.toEnglish.none", {
                                    language: native,
                                  })
                                : t(`books.translate.${direction}.hint`, {
                                    language: native,
                                  })}
                            </span>
                          </span>
                          <ChevronRight
                            aria-hidden
                            className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-enabled:group-hover:translate-x-0.5 group-enabled:group-hover:text-ink"
                          />
                        </button>
                      </Reveal>
                    );
                  })}
                </Stagger>
              </Reveal>

              <Presence>
                {found.attempts.length > 0 && (
                  <Reveal
                    as="section"
                    key="attempts"
                    className="flex flex-col gap-4"
                  >
                    <h2 className="font-medium text-ink">
                      {t("books.translate.attempts")}
                    </h2>
                    <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface py-1 shadow-card">
                      <Presence>
                        {found.attempts.map((attempt, index) => (
                          <AttemptRow
                            key={attempt.id}
                            attempt={attempt}
                            native={native}
                            index={index}
                            onOpen={() =>
                              void run(() => getAttempt(attempt.id))
                            }
                            onEnd={() =>
                              void run(async () => {
                                await closeAttempt(attempt.id, true);
                                return null;
                              })
                            }
                            onDelete={() =>
                              void run(async () => {
                                await deleteAttempt(attempt.id);
                                return null;
                              })
                            }
                          />
                        ))}
                      </Presence>
                    </ul>
                  </Reveal>
                )}
              </Presence>
            </Stagger>
          </Reveal>
        )}
      </Presence>
    </div>
  );
}
