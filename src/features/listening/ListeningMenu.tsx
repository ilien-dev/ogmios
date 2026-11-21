import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Ear } from "lucide-react";
import type { Book } from "@shared/domain";
import type { ListeningState, Pace } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import type { Navigate } from "@/app/routes";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { StatChip, StatTile } from "@/components/scene/Stats";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { BarRelief } from "@/features/drills/BarRelief";
import { HubScreen } from "@/features/drills/ScreenParts";
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

/** The share of the words heard at a pace, 0 before it was tried. */
function percentOf(right: number, total: number): number {
  return total === 0 ? 0 : Math.floor((right * 100) / total);
}

/**
 * The menu of the listening: the chapter with its dictation and its reading
 * aloud, the dictations left unfinished and the words that escape the ear in
 * the column; the paces raised in the scene, the one understood lit, with how
 * each stands along its bottom. Without the voice it only offers to get it.
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
  const standings = state?.standings ?? [];
  const typed = standings.reduce((sum, each) => sum + each.sentences, 0);
  const shown = state !== null && !voiceless;
  return (
    <HubScreen
      aside={
        <>
          <Reveal className="flex flex-wrap gap-2">
            <StatChip value={state?.paused.length ?? "–"} tone="accent">
              {t("listening.board.paused", {
                count: state?.paused.length ?? 0,
              })}
            </StatChip>
            <StatChip value={state?.reinforced.length ?? "–"}>
              {t("listening.board.reinforced", {
                count: state?.reinforced.length ?? 0,
              })}
            </StatChip>
          </Reveal>
          <Reveal className="grid grid-cols-2 gap-3">
            <StatTile
              icon={<AudioLines aria-hidden className="size-6 text-book" />}
              label={t("listening.board.typed")}
              value={typed}
            />
            <StatTile
              icon={<Ear aria-hidden className="size-6 text-wrong" />}
              label={t("listening.board.escaping")}
              value={state?.missed.length ?? 0}
            />
          </Reveal>
          <Presence>
            {state === null && failure === null && (
              <Reveal key="wait" kind="fade" className="px-1">
                <Spinner />
              </Reveal>
            )}
          </Presence>
          <Presence>
            {voiceless && (
              <Reveal
                as="section"
                key="voice"
                className="flex flex-col items-start gap-4 rounded-xl glass p-5"
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
            {shown && on === null && (
              <Reveal
                key="noBook"
                as="section"
                className="flex flex-col items-start gap-4 rounded-xl glass p-5"
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
            )}
          </Presence>
          <Presence>
            {shown && on !== null && (
              <Reveal key="on">
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
                      navigate({
                        name: "listening",
                        running: sitting.id,
                      });
                    })
                  }
                  onListen={() => {
                    navigate({
                      name: "listening",
                      reading: on.chapter.id,
                    });
                  }}
                />
              </Reveal>
            )}
          </Presence>
          <Presence>
            {shown && state.paused.length > 0 && (
              <Reveal key="paused">
                <PausedDictations
                  paused={state.paused}
                  onContinue={(id) => {
                    navigate({ name: "listening", running: id });
                  }}
                  onEnd={(id) =>
                    void run(async () => {
                      await closeDictation(id, true);
                      setState(await listeningState(on?.chapter.id ?? null));
                    })
                  }
                />
              </Reveal>
            )}
          </Presence>
          <Presence>
            {shown && state.missed.length > 0 && (
              <Reveal key="missed">
                <Escaping state={state} />
              </Reveal>
            )}
          </Presence>
        </>
      }
      scene={
        <Scene
          label={t("listening.board.scene")}
          className="flex-1"
          header={
            <>
              <SceneTitle>{t("listening.title")}</SceneTitle>
              <p className="max-w-prose text-ink-soft">
                {t("listening.intro")}
              </p>
              <Presence>
                {failure !== null && (
                  <Notice key="failure" tone="danger">
                    {t("common.error", { message: failure })}
                  </Notice>
                )}
              </Presence>
            </>
          }
          footer={
            <Presence>
              {shown && (
                <Reveal key="standing">
                  <Standing state={state} />
                </Reveal>
              )}
            </Presence>
          }
        >
          <BarRelief
            label={t("listening.board.relief", {
              paces: standings
                .map((each) =>
                  t("listening.board.reliefPace", {
                    pace: t(`listening.pace.${each.pace}`),
                    percent: percentOf(each.right, each.total),
                  }),
                )
                .join(", "),
            })}
            bars={standings.map((each) => ({
              key: each.pace,
              value: percentOf(each.right, each.total),
              look: each.held ? "book" : "plain",
              tip: {
                title: t(`listening.pace.${each.pace}`),
                lines: [
                  t("scene.tip.right", {
                    percent: percentOf(each.right, each.total),
                  }),
                ],
              },
              pin: each.pace === state?.understood ? "book" : undefined,
            }))}
            className="size-full max-w-2xl px-6 pt-36 pb-80"
          />
        </Scene>
      }
    />
  );
}
