import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Dictation, DictationResult, Pace } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { RunFrame } from "@/features/books/RunFrame";
import { SittingStage } from "@/features/books/SittingParts";
import { errorMessage } from "@/lib/errors";
import {
  answerDictation,
  closeDictation,
  getDictation,
  hearDictation,
  startDictation,
  ttsStop,
} from "@/lib/ipc";
import { DictationEnd } from "./DictationEnd";
import { DictationPlayer } from "./DictationPlayer";
import { DictationWriting } from "./DictationWriting";
import { useHushed } from "./useHushed";

interface DictationRunProps {
  sittingId: string;
  /** Back to the menu: the dictation was paused, or its summary was read. */
  onLeave: () => void;
  /** Another dictation was started. */
  onAgain: (sittingId: string) => void;
}

/**
 * One dictation with the whole window: a sentence at a time, typed on the
 * left with what plays it on the right, and under it, always, the two ways
 * out: pausing, to go on later, and finishing. Once finished it says how it
 * went.
 */
export function DictationRun({
  sittingId,
  onLeave,
  onAgain,
}: DictationRunProps): ReactNode {
  const { t } = useTranslation();
  const [sitting, setSitting] = useState<Dictation | null>(null);
  const [result, setResult] = useState<DictationResult | null>(null);
  const [sent, setSent] = useState("");
  /** The pace picked on the way; null for the one it was started at. */
  const [picked, setPicked] = useState<Pace | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Counts the sentences left behind: a listen to an older one is ignored. */
  const turns = useHushed();

  useEffect(() => {
    let live = true;
    getDictation(sittingId)
      .then((opened) => {
        if (live) {
          setSitting(opened);
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
  }, [sittingId]);

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

  if (sitting === null) {
    return (
      <main className="grid h-full place-items-center px-10">
        {failure === null ? (
          <Spinner />
        ) : (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </main>
    );
  }

  const { summary, chapterId } = sitting;
  if (summary !== null) {
    return (
      <DictationEnd
        summary={summary}
        again={chapterId !== null}
        starting={busy}
        onAgain={(pace) =>
          void run(async () => {
            if (chapterId !== null) {
              const started = await startDictation(chapterId, pace);
              onAgain(started.id);
            }
          })
        }
        onDone={onLeave}
      />
    );
  }

  const { item } = sitting;
  const pace = picked ?? sitting.pace;
  /** Stops what is being heard: the sentence on the screen is left behind. */
  const hush = (): void => {
    turns.next();
    setPlaying(false);
    void ttsStop().catch(() => null);
  };
  const listen = (): void => {
    if (item === null || result !== null || playing) {
      return;
    }
    const mine = turns.now();
    setPlaying(true);
    setFailure(null);
    hearDictation(sittingId, item.index, pace)
      .then((heard) => {
        if (turns.now() === mine) {
          setPlaying(false);
          setSitting(heard);
        }
      })
      .catch((error: unknown) => {
        if (turns.now() === mine) {
          setPlaying(false);
          setFailure(errorMessage(error));
        }
      });
  };
  const check = (text: string): void => {
    if (item === null || busy) {
      return;
    }
    const written = text.trim();
    hush();
    void run(async () => {
      setResult(await answerDictation(sittingId, item.index, written, pace));
      setSent(written);
    });
  };
  const next = (): void => {
    // Enter on the way on is one step: a second one finds it running.
    if (busy) {
      return;
    }
    hush();
    void run(async () => {
      setSitting(await getDictation(sittingId));
      setResult(null);
      setSent("");
    });
  };
  /** Pauses the dictation, or finishes it and shows how it went. */
  const leave = (finished: boolean): void => {
    hush();
    void run(async () => {
      await closeDictation(sittingId, finished);
      // One with nothing answered is not kept: there is nothing to show.
      if (finished && sitting.done + (result === null ? 0 : 1) > 0) {
        setSitting(await getDictation(sittingId));
      } else {
        onLeave();
      }
    });
  };

  const answered = sitting.done + (result === null ? 0 : 1);
  return (
    <RunFrame
      barLabel={t("listening.run.progress")}
      value={answered}
      total={sitting.total}
      count={t("listening.run.count", {
        current: Math.min(sitting.done + 1, sitting.total),
        total: sitting.total,
      })}
      failure={failure}
      busy={busy}
      pause={t("listening.run.pause")}
      finish={t("listening.run.finish")}
      onPause={() => {
        leave(false);
      }}
      onFinish={() => {
        leave(true);
      }}
    >
      {item !== null && (
        <SittingStage step={String(item.index)}>
          <div className="mx-auto grid w-full max-w-5xl grid-cols-5 items-start gap-10 p-6 nav:px-10">
            <div className="col-span-3">
              <DictationWriting
                item={item}
                result={result}
                sent={sent}
                checking={busy && result === null}
                last={answered >= sitting.total && result?.verdict !== "wrong"}
                onCheck={check}
                onListen={listen}
                onNext={next}
              />
            </div>
            <div className="col-span-2">
              <Presence>
                {result === null && (
                  <DictationPlayer
                    key="player"
                    item={item}
                    pace={pace}
                    playing={playing}
                    onPace={setPicked}
                    onListen={listen}
                    onStop={() => {
                      void ttsStop().catch(() => null);
                    }}
                  />
                )}
              </Presence>
            </div>
          </div>
        </SittingStage>
      )}
    </RunFrame>
  );
}
