import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { SentencePart } from "@shared/domain";
import type { ChapterReading, Pace } from "@shared/listening";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { chapterName } from "@/features/books/chapterName";
import { Learned } from "@/features/books/TranslateRows";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import {
  chapterReading,
  listenChapter,
  onChapterListening,
  ttsStop,
} from "@/lib/ipc";
import { PaceChoice } from "./PaceChoice";

interface TextProps {
  paragraphs: readonly SentencePart[][][];
  /** The sentence being heard, or the one to start from. */
  place: number;
  onJump: (sentence: number) => void;
}

/**
 * The chapter, a sentence at a time: the one being heard is marked, and the
 * words the learner has learned are underlined as when it is translated.
 */
function Text({ paragraphs, place, onJump }: TextProps): ReactNode {
  const current = useRef<HTMLSpanElement>(null);
  /** The place of the first sentence of each paragraph. */
  const starts = useMemo(
    () =>
      paragraphs.map((_, at) =>
        paragraphs
          .slice(0, at)
          .reduce((before, paragraph) => before + paragraph.length, 0),
      ),
    [paragraphs],
  );

  useEffect(() => {
    current.current?.scrollIntoView({ block: "center" });
  }, [place]);

  return (
    <div className="flex flex-col gap-5 text-lead text-ink-soft" lang="en">
      {paragraphs.map((paragraph, at) => {
        const start = starts[at] ?? 0;
        return (
          <p key={start}>
            {paragraph.map((sentence, within) => {
              const index = start + within;
              const on = index === place;
              return (
                <span key={index}>
                  <span
                    ref={on ? current : undefined}
                    role="button"
                    tabIndex={-1}
                    aria-current={on ? "true" : undefined}
                    onClick={() => {
                      onJump(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        onJump(index);
                      }
                    }}
                    className={cn(
                      "cursor-pointer rounded-sm box-decoration-clone px-0.5 hover:bg-raised",
                      on && "bg-accent-soft text-ink",
                    )}
                  >
                    <Learned sentences={[sentence]} />
                  </span>{" "}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}

interface ChapterListenProps {
  chapterId: string;
  onBack: () => void;
}

/**
 * A chapter read aloud: its text with the sentence being heard marked, and
 * under it the player. It goes on from where it was left; a sentence
 * clicked is where it goes on from. The text can be hidden, to only listen.
 */
export function ChapterListen({
  chapterId,
  onBack,
}: ChapterListenProps): ReactNode {
  const { t } = useTranslation();
  const [reading, setReading] = useState<ChapterReading | null>(null);
  const [place, setPlace] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pace, setPace] = useState<Pace>("normal");
  const [hidden, setHidden] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Counts what was asked to be read: an older reading is no longer it. */
  const turn = useRef(0);

  useEffect(() => {
    let live = true;
    chapterReading(chapterId)
      .then((loaded) => {
        if (live) {
          setReading(loaded);
          setPlace(loaded.place);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    const unlisten = onChapterListening((heard) => {
      if (live && heard.chapterId === chapterId) {
        setPlace(heard.sentence);
      }
    });
    return () => {
      live = false;
      turn.current += 1;
      void ttsStop().catch(() => null);
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [chapterId]);

  if (reading === null) {
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

  const total = reading.paragraphs.reduce(
    (count, paragraph) => count + paragraph.length,
    0,
  );
  const play = (from: number, at: Pace): void => {
    turn.current += 1;
    const mine = turn.current;
    setPlaying(true);
    setFailure(null);
    setPlace(from);
    listenChapter(chapterId, from, at)
      .then((ended) => {
        if (turn.current === mine) {
          setPlaying(false);
          if (ended) {
            setPlace(0);
          }
        }
      })
      .catch((error: unknown) => {
        if (turn.current === mine) {
          setPlaying(false);
          setFailure(errorMessage(error));
        }
      });
  };
  const pause = (): void => {
    turn.current += 1;
    setPlaying(false);
    void ttsStop().catch(() => null);
  };
  const jump = (to: number): void => {
    const at = Math.min(Math.max(to, 0), total - 1);
    if (playing) {
      play(at, pace);
    } else {
      setPlace(at);
    }
  };

  return (
    <main className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-10 py-12">
          <header className="flex flex-col gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 self-start"
              icon={<ArrowLeft aria-hidden className="size-4" />}
              onClick={onBack}
            >
              {t("listening.reading.back")}
            </Button>
            <p className="text-sm text-ink-faint">{reading.bookTitle}</p>
            <h1 className="text-display font-semibold text-ink">
              {chapterName(reading.chapter, t)}
            </h1>
          </header>
          {failure !== null && (
            <Notice tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}
          {hidden ? (
            <p className="text-ink-faint">{t("listening.reading.hidden")}</p>
          ) : (
            <Text paragraphs={reading.paragraphs} place={place} onJump={jump} />
          )}
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-surface px-10 py-4">
        <Button
          aria-label={t("listening.reading.previous")}
          icon={<SkipBack aria-hidden className="size-4" />}
          disabled={place === 0}
          onClick={() => {
            jump(place - 1);
          }}
        />
        <Button
          variant="primary"
          aria-label={
            playing ? t("listening.reading.pause") : t("listening.reading.play")
          }
          icon={
            playing ? (
              <Pause aria-hidden className="size-4" />
            ) : (
              <Play aria-hidden className="size-4" />
            )
          }
          disabled={total === 0}
          onClick={() => {
            if (playing) {
              pause();
            } else {
              play(place, pace);
            }
          }}
        />
        <Button
          aria-label={t("listening.reading.next")}
          icon={<SkipForward aria-hidden className="size-4" />}
          disabled={place >= total - 1}
          onClick={() => {
            jump(place + 1);
          }}
        />
        <div className="min-w-24 flex-1">
          <ProgressBar
            label={t("listening.reading.progress")}
            value={place}
            total={Math.max(total - 1, 1)}
          />
        </div>
        <p className="text-sm text-ink-faint tabular-nums">
          {t("listening.reading.place", { current: place + 1, total })}
        </p>
        <PaceChoice
          value={pace}
          onChange={(next) => {
            setPace(next);
            if (playing) {
              play(place, next);
            }
          }}
        />
        <Button
          variant="ghost"
          aria-pressed={hidden}
          icon={
            hidden ? (
              <Eye aria-hidden className="size-4" />
            ) : (
              <EyeOff aria-hidden className="size-4" />
            )
          }
          onClick={() => {
            setHidden(!hidden);
          }}
        >
          {hidden ? t("listening.reading.show") : t("listening.reading.hide")}
        </Button>
      </footer>
    </main>
  );
}
