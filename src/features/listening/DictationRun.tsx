import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Square, Volume2 } from "lucide-react";
import type {
  Dictation,
  DictationItem,
  DictationResult,
  DictationSummary,
  Pace,
} from "@shared/listening";
import { PACES } from "@shared/listening";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { TextArea } from "@/components/ui/TextArea";
import { GRADE_TEXT, VerdictLine } from "@/components/ui/Verdict";
import { Key } from "@/features/books/TriageRun";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { VERDICT_GRADE } from "@/lib/grade";
import {
  answerDictation,
  closeDictation,
  getDictation,
  hearDictation,
  startDictation,
  ttsStop,
} from "@/lib/ipc";
import { PaceChoice } from "./PaceChoice";

/** Listening to a sentence more often than this is help. */
const FREE_LISTENS = 2;

interface WritingProps {
  item: DictationItem;
  result: DictationResult | null;
  /** What was typed for the sentence judged. */
  sent: string;
  checking: boolean;
  /** The sentence judged is the last of the dictation. */
  last: boolean;
  onCheck: (text: string) => void;
  onListen: () => void;
  onNext: () => void;
}

/** The left of a dictation: where it is typed, and what it was worth. */
function Writing({
  item,
  result,
  sent,
  checking,
  last,
  onCheck,
  onListen,
  onNext,
}: WritingProps): ReactNode {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const next = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (result !== null) {
      next.current?.focus();
    }
  }, [result]);

  if (result === null) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onCheck(text);
        }}
      >
        <h1 className="text-title font-semibold text-ink">
          {t("listening.run.field")}
        </h1>
        {item.retry && (
          <p className="text-sm text-ink-soft">{t("listening.run.retry")}</p>
        )}
        <TextArea
          aria-label={t("listening.run.field")}
          rows={3}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          lang="en"
          disabled={checking}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            // By the key, not the letter: Option+L types another on a Mac.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onCheck(text);
            } else if (event.altKey && event.code === "KeyN") {
              event.preventDefault();
              onCheck("");
            } else if (event.altKey && event.code === "KeyL") {
              event.preventDefault();
              onListen();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={checking}>
            {t("listening.run.check")}
            <Key>{t("structures.run.checkKey")}</Key>
          </Button>
          <Button
            variant="ghost"
            disabled={checking}
            aria-keyshortcuts={t("structures.run.skipKey")}
            onClick={() => {
              onCheck("");
            }}
          >
            {t("listening.run.unknown")}
            <Key>{t("structures.run.skipKey")}</Key>
          </Button>
        </div>
      </form>
    );
  }

  const right = result.words.filter((word) => word.heard).length;
  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      <div className="flex flex-col gap-2">
        <VerdictLine tone={VERDICT_GRADE[result.verdict]}>
          {t(`listening.run.verdict.${result.verdict}`, {
            right,
            total: result.words.length,
          })}
        </VerdictLine>
        {sent !== "" && (
          <p className="text-ink-soft" lang="en">
            {sent}
          </p>
        )}
        {result.verdict === "partial" && (
          <p className="text-sm text-partial">
            {result.slowed
              ? t("listening.run.why.slowed")
              : t("listening.run.why.listens")}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-faint">{t("listening.run.said")}</p>
        <p className="text-lead text-ink" lang="en">
          {result.words.map((word, at) => (
            // The words of a sentence never change place.
            <span key={at}>
              <span
                className={cn(
                  !word.heard &&
                    "font-medium underline decoration-2 underline-offset-4",
                  !word.heard && GRADE_TEXT.wrong,
                )}
              >
                {word.text}
              </span>{" "}
            </span>
          ))}
          <SpeakButton text={result.sentence} />
        </p>
      </div>
      <Button
        ref={next}
        variant="primary"
        className="self-start"
        onClick={onNext}
      >
        {last ? t("listening.run.last") : t("listening.run.next")}
        <Key>{t("structures.run.checkKey")}</Key>
      </Button>
    </div>
  );
}

interface PlayerProps {
  item: DictationItem;
  pace: Pace;
  playing: boolean;
  onPace: (pace: Pace) => void;
  onListen: () => void;
  onStop: () => void;
}

/** The right of a dictation: the sentence, to hear at a pace. */
function Player({
  item,
  pace,
  playing,
  onPace,
  onListen,
  onStop,
}: PlayerProps): ReactNode {
  const { t } = useTranslation();
  const heard = item.listens + (playing ? 1 : 0);
  let label = t("listening.run.play");
  if (playing) {
    label = t("listening.run.stop");
  } else if (heard > 0) {
    label = t("listening.run.again");
  }
  return (
    <aside className="flex flex-col items-start gap-4 rounded-lg border border-line bg-surface p-6">
      <Button
        variant="primary"
        size="lg"
        aria-keyshortcuts={t("listening.run.playKey")}
        icon={
          playing ? (
            <Square aria-hidden className="size-4 fill-current" />
          ) : (
            <Volume2 aria-hidden className="size-5" />
          )
        }
        onClick={playing ? onStop : onListen}
      >
        {label}
        {!playing && <Key>{t("listening.run.playKey")}</Key>}
      </Button>
      <PaceChoice value={pace} onChange={onPace} />
      <p
        className={cn(
          "text-sm tabular-nums",
          heard > FREE_LISTENS ? "text-partial" : "text-ink-soft",
        )}
      >
        {t("listening.run.listens", { count: heard })}
      </p>
      <p className="text-sm text-ink-faint">{t("listening.run.free")}</p>
    </aside>
  );
}

/** The pace a hint points at, from the one a dictation went at. */
function hinted(summary: DictationSummary): Pace {
  const at = PACES.indexOf(summary.pace);
  if (summary.hint === "faster") {
    return PACES[at + 1] ?? summary.pace;
  }
  if (summary.hint === "slower") {
    return PACES[at - 1] ?? summary.pace;
  }
  return summary.pace;
}

interface EndProps {
  summary: DictationSummary;
  /** Another can be started: the book it was on is still there. */
  again: boolean;
  starting: boolean;
  onAgain: (pace: Pace) => void;
  onDone: () => void;
}

/** How a dictation ended, and the way into another at the pace it suggests. */
function End({
  summary,
  again,
  starting,
  onAgain,
  onDone,
}: EndProps): ReactNode {
  const { t } = useTranslation();
  const [pace, setPace] = useState<Pace>(hinted(summary));
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const tallies = [
    ["right", summary.correct, t("listening.summary.correct")],
    ["partial", summary.partial, t("listening.summary.partial")],
    ["wrong", summary.wrong, t("listening.summary.wrong")],
  ] as const;
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-10">
      <div className="flex w-full max-w-lg flex-col gap-8 motion-safe:animate-rise">
        <header className="flex flex-col gap-2">
          <h1 className="text-display font-semibold text-ink">
            {t("listening.summary.title")}
          </h1>
          <p className="text-lead text-ink-soft">
            {t("listening.summary.lead", {
              right: summary.right,
              total: summary.total,
              pace: t(`listening.pace.${summary.pace}`).toLowerCase(),
            })}
          </p>
        </header>
        <dl className="flex gap-10">
          {tallies.map(([grade, count, label]) => (
            <div key={grade} className="flex flex-col">
              <dd
                className={cn(
                  "text-title font-semibold tabular-nums",
                  GRADE_TEXT[grade],
                )}
              >
                {count}
              </dd>
              <dt className="text-sm text-ink-soft">{label}</dt>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2">
          <p className="font-medium text-accent-text">
            {summary.understood === null
              ? t("listening.summary.notYet")
              : t("listening.summary.understood", {
                  pace: t(`listening.pace.${summary.understood}`).toLowerCase(),
                })}
          </p>
          {summary.hint !== null && (
            <p className="text-ink-soft">
              {t(`listening.summary.hint.${summary.hint}`)}
            </p>
          )}
        </div>
        {again && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-ink-faint">
              {t("listening.summary.next")}
            </p>
            <PaceChoice value={pace} onChange={setPace} />
          </div>
        )}
        <div className="flex gap-2">
          {again && (
            <Button
              ref={first}
              variant="primary"
              disabled={starting}
              onClick={() => {
                onAgain(pace);
              }}
            >
              {t("listening.summary.again")}
            </Button>
          )}
          <Button
            ref={again ? undefined : first}
            variant="ghost"
            onClick={onDone}
          >
            {t("common.done")}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
  const turn = useRef(0);

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
      turn.current += 1;
      void ttsStop().catch(() => null);
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
      <main className="h-full">
        <End
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
      </main>
    );
  }

  const { item } = sitting;
  const pace = picked ?? sitting.pace;
  /** Stops what is being heard: the sentence on the screen is left behind. */
  const hush = (): void => {
    turn.current += 1;
    setPlaying(false);
    void ttsStop().catch(() => null);
  };
  const listen = (): void => {
    if (item === null || result !== null || playing) {
      return;
    }
    const mine = turn.current;
    setPlaying(true);
    setFailure(null);
    hearDictation(sittingId, item.index, pace)
      .then((heard) => {
        if (turn.current === mine) {
          setPlaying(false);
          setSitting(heard);
        }
      })
      .catch((error: unknown) => {
        if (turn.current === mine) {
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
    <main className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-6 px-10">
        <div className="min-w-0 flex-1">
          <ProgressBar
            label={t("listening.run.progress")}
            value={answered}
            total={sitting.total}
          />
        </div>
        <p className="text-sm text-ink-faint tabular-nums">
          {t("listening.run.count", {
            current: Math.min(sitting.done + 1, sitting.total),
            total: sitting.total,
          })}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-10 py-8">
          {failure !== null && (
            <Notice tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}
          {item !== null && (
            <div className="grid grid-cols-5 items-start gap-10">
              <div className="col-span-3">
                <Writing
                  key={item.index}
                  item={item}
                  result={result}
                  sent={sent}
                  checking={busy && result === null}
                  last={
                    answered >= sitting.total && result?.verdict !== "wrong"
                  }
                  onCheck={check}
                  onListen={listen}
                  onNext={next}
                />
              </div>
              {result === null && (
                <div className="col-span-2">
                  <Player
                    item={item}
                    pace={pace}
                    playing={playing}
                    onPace={setPicked}
                    onListen={listen}
                    onStop={() => {
                      void ttsStop().catch(() => null);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <footer className="flex shrink-0 gap-3 border-t border-line px-10 py-4">
        <Button
          disabled={busy}
          onClick={() => {
            leave(false);
          }}
        >
          {t("listening.run.pause")}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            leave(true);
          }}
        >
          {t("listening.run.finish")}
        </Button>
      </footer>
    </main>
  );
}
