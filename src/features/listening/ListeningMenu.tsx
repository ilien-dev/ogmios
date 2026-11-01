import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Book } from "@shared/domain";
import type { ListeningState, Pace } from "@shared/listening";
import type { Navigate } from "@/app/routes";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Orb } from "@/components/ui/Orb";
import { Spinner } from "@/components/ui/Spinner";
import { useSpeech } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import {
  closeDictation,
  listBooks,
  listeningState,
  startDictation,
} from "@/lib/ipc";
import { formatBytes } from "@/lib/text";
import { Escaping } from "./Escaping";
import { OnChapter } from "./OnChapter";
import { PausedDictations } from "./PausedDictations";
import { Standing } from "./Standing";

interface ListeningMenuProps {
  /** The chapter to be on; null for the one opened last. */
  chapterId: string | null;
  navigate: Navigate;
}

/**
 * The menu of the listening: the pace understood, the chapter with its
 * dictation and its reading aloud, the dictations left unfinished and the
 * words that escape the ear. Without the voice it only offers to get it.
 */
export function ListeningMenu({
  chapterId,
  navigate,
}: ListeningMenuProps): ReactNode {
  const { t, i18n } = useTranslation();
  const { status, fetching, fetch } = useSpeech();
  const [state, setState] = useState<ListeningState | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  /** The pace picked for the next dictation; null for the one offered. */
  const [picked, setPicked] = useState<Pace | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      const [loaded, shelf] = await Promise.all([
        listeningState(chapterId),
        listBooks(),
      ]);
      // Before any chapter was opened, the first of the shelf is the one.
      const first = shelf[0]?.chapters[0]?.id;
      const shown =
        loaded.chapter === null && first !== undefined
          ? await listeningState(first)
          : loaded;
      if (live) {
        setState(shown);
        setBooks(shelf);
      }
    };
    load().catch((error: unknown) => {
      if (live) {
        setFailure(errorMessage(error));
      }
    });
    return () => {
      live = false;
    };
  }, [chapterId]);

  /** Runs one step with the backend, showing why it failed if it does. */
  const run = async (step: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await step();
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  const on = state?.chapter ?? null;
  const voiceless = status !== null && !status.downloaded;
  return (
    <main className="h-full overflow-y-auto">
      <Stagger className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12 nav:py-16">
        <Reveal as="header" className="flex flex-col gap-4">
          <Orb size="sm" section="book" />
          <h1 className="font-display text-display font-light text-ink">
            {t("listening.title")}
          </h1>
          <p className="text-lead text-ink-soft">{t("listening.intro")}</p>
        </Reveal>
        <Presence>
          {failure !== null && (
            <Notice key="failure" tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}
          {state === null && failure === null && (
            <Reveal key="wait" kind="fade">
              <Spinner />
            </Reveal>
          )}
        </Presence>
        <Presence>
          {voiceless && (
            <Reveal
              as="section"
              key="voice"
              className="flex flex-col items-start gap-4"
            >
              <Notice>{t("listening.voice.need")}</Notice>
              <Button
                variant="primaryBook"
                disabled={fetching !== null}
                onClick={() => {
                  fetch().catch((error: unknown) => {
                    setFailure(errorMessage(error));
                  });
                }}
              >
                {fetching === null
                  ? t("listening.voice.get", {
                      size: formatBytes(status.bytes, i18n.language),
                    })
                  : t("listening.voice.getting", {
                      percent: Math.round(fetching * 100),
                    })}
              </Button>
            </Reveal>
          )}
        </Presence>
        <Presence>
          {state !== null && !voiceless && (
            <Reveal key="loaded" kind="fade">
              <Stagger className="flex flex-col gap-10">
                <Standing state={state} />
                {on === null ? (
                  <Reveal
                    as="section"
                    className="flex flex-col items-start gap-4"
                  >
                    <Notice>{t("listening.noBook")}</Notice>
                    <Button
                      onClick={() => {
                        navigate({ name: "books", bookId: null });
                      }}
                    >
                      {t("listening.toBooks")}
                    </Button>
                  </Reveal>
                ) : (
                  <OnChapter
                    on={on}
                    books={books}
                    pace={picked ?? state.pace}
                    busy={busy}
                    onPace={setPicked}
                    onChapter={(next) => {
                      navigate({ name: "listening", chapterId: next });
                    }}
                    onDictation={() =>
                      void run(async () => {
                        const sitting = await startDictation(
                          on.chapter.id,
                          picked ?? state.pace,
                        );
                        navigate({ name: "listening", running: sitting.id });
                      })
                    }
                    onListen={() => {
                      navigate({ name: "listening", reading: on.chapter.id });
                    }}
                  />
                )}
                <Presence>
                  {state.paused.length > 0 && (
                    <Reveal key="paused">
                      <PausedDictations
                        paused={state.paused}
                        onContinue={(id) => {
                          navigate({ name: "listening", running: id });
                        }}
                        onEnd={(id) =>
                          void run(async () => {
                            await closeDictation(id, true);
                            setState(
                              await listeningState(on?.chapter.id ?? null),
                            );
                          })
                        }
                      />
                    </Reveal>
                  )}
                </Presence>
                {state.missed.length > 0 && <Escaping state={state} />}
              </Stagger>
            </Reveal>
          )}
        </Presence>
      </Stagger>
    </main>
  );
}
