import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import type {
  Translation,
  TranslationAttempts,
  TranslationDirection,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
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
 * Where a session begins: a new attempt in one direction, chosen here with a
 * pill and not inside it, or one of the attempts kept. A paused one is gone on with
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
  const [direction, setDirection] = useState<TranslationDirection>("toNative");

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

  /** Nothing is whole in the learner's language yet to bring back. */
  const closed = found?.back === 0;
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
                <div
                  role="group"
                  aria-label={t("books.translate.direction")}
                  className="flex gap-1 rounded-3xl bg-sunken p-1 @max-md:flex-col"
                >
                  {DIRECTIONS.map((each) => {
                    const on = each === direction;
                    return (
                      <button
                        key={each}
                        type="button"
                        aria-pressed={on}
                        disabled={each === "toEnglish" && closed}
                        onClick={() => {
                          setDirection(each);
                        }}
                        className={cn(
                          "relative flex h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm transition-control disabled:cursor-not-allowed disabled:text-ink-faint",
                          on
                            ? "font-semibold text-ink"
                            : "text-ink-soft hover:enabled:text-ink",
                        )}
                      >
                        {on && (
                          <motion.span
                            aria-hidden
                            layoutId={`${chapterId}-direction`}
                            transition={{
                              type: "spring",
                              stiffness: 420,
                              damping: 36,
                            }}
                            className="absolute inset-0 rounded-full bg-surface shadow-card"
                          />
                        )}
                        <span
                          aria-hidden
                          className={cn(
                            "relative size-2 rounded-full",
                            each === "toNative" ? "bg-book" : "bg-accent",
                          )}
                        />
                        <span className="relative">
                          {t(`books.translate.${each}.name`, {
                            language: native,
                          })}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="relative">
                  <Presence swap>
                    <Reveal
                      key={direction}
                      as="p"
                      kind="fade"
                      className="text-sm text-ink-soft"
                    >
                      {t(`books.translate.${direction}.hint`, {
                        language: native,
                      })}
                    </Reveal>
                  </Presence>
                </div>
                <Presence>
                  {closed && (
                    <Reveal
                      key="closed"
                      as="p"
                      kind="fade"
                      className="text-sm text-ink-faint"
                    >
                      {t("books.translate.toEnglish.none", {
                        language: native,
                      })}
                    </Reveal>
                  )}
                </Presence>
                <Button
                  variant="primaryBook"
                  size="lg"
                  className="self-start @max-md:self-stretch"
                  onClick={() =>
                    void run(() => startAttempt(chapterId, direction))
                  }
                >
                  {t("books.translate.start")}
                </Button>
              </Reveal>

              <Presence>
                {found.attempts.length > 0 && (
                  <Reveal
                    as="section"
                    key="attempts"
                    className="flex flex-col gap-4"
                  >
                    <h2 className="font-display font-medium tracking-tight text-ink">
                      {t("books.translate.attempts")}
                    </h2>
                    <ul className="flex flex-col divide-y divide-line rounded-xl glass py-1">
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
