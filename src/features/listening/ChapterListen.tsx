import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChapterReading, Pace } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { BackLink } from "@/components/ui/BackLink";
import { Notice } from "@/components/ui/Notice";
import { chapterName } from "@/features/books/chapterName";
import { SittingWait } from "@/features/books/SittingParts";
import { errorMessage } from "@/lib/errors";
import {
  chapterReading,
  listenChapter,
  onChapterListening,
  ttsStop,
} from "@/lib/ipc";
import { ListenPlayer } from "./ListenPlayer";
import { ListenText } from "./ListenText";
import { useHushed } from "./useHushed";

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
  const turns = useHushed();

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
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [chapterId]);

  const total = (reading?.paragraphs ?? []).reduce(
    (count, paragraph) => count + paragraph.length,
    0,
  );
  const play = (from: number, at: Pace): void => {
    turns.next();
    const mine = turns.now();
    setPlaying(true);
    setFailure(null);
    setPlace(from);
    listenChapter(chapterId, from, at)
      .then((ended) => {
        if (turns.now() === mine) {
          setPlaying(false);
          if (ended) {
            setPlace(0);
          }
        }
      })
      .catch((error: unknown) => {
        if (turns.now() === mine) {
          setPlaying(false);
          setFailure(errorMessage(error));
        }
      });
  };
  const pause = (): void => {
    turns.next();
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
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <Presence swap>
          {reading === null ? (
            <Reveal key="wait" kind="fade" className="h-full">
              <SittingWait failure={failure} />
            </Reveal>
          ) : (
            <Reveal key="text" kind="fade">
              <Stagger className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12 nav:px-10">
                <Reveal as="header" className="flex flex-col gap-3">
                  <BackLink
                    label={t("listening.reading.back")}
                    onClick={onBack}
                  />
                  <p className="text-sm text-ink-faint">{reading.bookTitle}</p>
                  <h1 className="font-display text-display font-light text-ink">
                    {chapterName(reading.chapter, t)}
                  </h1>
                </Reveal>
                <Presence>
                  {failure !== null && (
                    <Notice key="failure" tone="danger">
                      {t("common.error", { message: failure })}
                    </Notice>
                  )}
                </Presence>
                <div className="relative">
                  <Presence swap>
                    {hidden ? (
                      <Reveal
                        as="p"
                        key="hidden"
                        kind="fade"
                        className="text-ink-faint"
                      >
                        {t("listening.reading.hidden")}
                      </Reveal>
                    ) : (
                      <Reveal key="text" kind="fade">
                        <ListenText
                          paragraphs={reading.paragraphs}
                          place={place}
                          onJump={jump}
                        />
                      </Reveal>
                    )}
                  </Presence>
                </div>
              </Stagger>
            </Reveal>
          )}
        </Presence>
      </div>
      <Presence>
        {reading !== null && (
          <Reveal key="player" className="shrink-0 px-6 pb-4 nav:px-10">
            <ListenPlayer
              place={place}
              total={total}
              playing={playing}
              pace={pace}
              hidden={hidden}
              onJump={jump}
              onPlay={() => {
                play(place, pace);
              }}
              onPause={pause}
              onPace={(next) => {
                setPace(next);
                if (playing) {
                  play(place, next);
                }
              }}
              onHidden={setHidden}
            />
          </Reveal>
        )}
      </Presence>
    </main>
  );
}
