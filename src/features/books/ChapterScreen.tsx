import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Book,
  BookWord,
  Chapter,
  ChapterProgress,
  ChapterRefusal,
  Depth,
  SentenceProgress,
} from "@shared/domain";
import { READY } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import {
  getChapterWords,
  labelWords,
  onChapterProgress,
  onSentenceProgress,
  prepareChapter,
  setWordKnown,
  writeSentences,
} from "@/lib/ipc";
import { ChapterAside } from "./ChapterAside";
import { DepthChoice } from "./DepthChoice";
import { PreparingBar } from "./PreparingBar";
import { WordList } from "./WordList";

/** As offered, widest first; a later one is shallower. */
const DEPTHS: readonly Depth[] = ["most", "relevant", "hardest"];
const REFUSALS: readonly ChapterRefusal[] = ["notEnglish"];

/** The depths that would add words to a chapter prepared at `prepared`. */
function deeperThan(prepared: Depth | null): readonly Depth[] {
  return prepared === null ? DEPTHS : DEPTHS.slice(0, DEPTHS.indexOf(prepared));
}

/** What went wrong, and the depth to ask for again when asking again helps. */
interface Failure {
  message: string;
  retry: Depth | null;
}

interface ChapterScreenProps {
  book: Book;
  chapter: Chapter;
  /** The chapter as it is once its words are in, or stand differently. */
  onPrepared: (chapter: Chapter) => void;
  navigate: Navigate;
}

/**
 * The words of the chapter the learner is on, as a tab of the book: the
 * choice of how many to learn, the reading of the chapter, and then its word
 * list with the way into practising it. A word the learner knows already is
 * set aside there, and can be taken back. A chapter that is ready to read
 * offers a warm-up of its done words. The chapter and its way in stand over
 * the words, in the one column of the tab.
 */
export function ChapterScreen({
  book,
  chapter,
  onPrepared,
  navigate,
}: ChapterScreenProps): ReactNode {
  const { t } = useTranslation();
  /** Null until read; a chapter not yet prepared has none to read. */
  const [words, setWords] = useState<BookWord[] | null>(
    chapter.prepared === null ? [] : null,
  );
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<ChapterProgress | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    const unlisten = onChapterProgress((heard) => {
      if (heard.chapterId === chapter.id) {
        setProgress(heard);
      }
    });
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [chapter.id]);

  // The sentences its words are asked with are prepared once it is
  // prepared and again whenever it is opened: a word never given them gets
  // them, and those an update left to look at again are. Practice waits for
  // them, so that it asks what the update brought. A failure lets it go on,
  // and says so: the words are asked as the chapter has them meanwhile.
  const [writing, setWriting] = useState<SentenceProgress | null>(null);
  const { prepared } = chapter;
  const [readying, setReadying] = useState(prepared !== null);
  const [unwritten, setUnwritten] = useState<string | null>(null);
  useEffect(() => {
    if (prepared === null) {
      return;
    }
    setReadying(true);
    setUnwritten(null);
    const unlisten = onSentenceProgress((heard) => {
      if (heard.chapterId === chapter.id) {
        setWriting(heard);
      }
    });
    // Words stored before words were labelled are said what kind they are
    // first: the list shows it, and the sentences are written knowing it.
    let live = true;
    const fill = async (): Promise<void> => {
      const labelled = await labelWords().catch(() => 0);
      if (labelled > 0 && live) {
        // A list that cannot be read again stays as it is.
        const found = await getChapterWords(chapter.id).catch(() => null);
        if (found !== null && live) {
          setWords(found.words);
        }
      }
      await writeSentences(chapter.id);
    };
    fill()
      .catch((error: unknown) => {
        if (live) {
          setUnwritten(errorMessage(error));
        }
      })
      .finally(() => {
        if (live) {
          setReadying(false);
        }
      });
    return () => {
      live = false;
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [chapter.id, prepared]);

  const stored = chapter.prepared !== null && words === null && !preparing;
  useEffect(() => {
    let live = stored;
    if (stored) {
      getChapterWords(chapter.id)
        .then((found) => {
          if (live) {
            setWords(found.words);
          }
        })
        .catch((error: unknown) => {
          if (live) {
            setFailure({ message: errorMessage(error), retry: null });
            setWords([]);
          }
        });
    }
    return () => {
      live = false;
    };
  }, [chapter.id, stored]);

  const prepare = async (depth: Depth): Promise<void> => {
    setPreparing(true);
    setProgress(null);
    setFailure(null);
    try {
      const found = await prepareChapter(chapter.id, depth);
      setWords(found.words);
      onPrepared(found.chapter);
    } catch (error) {
      const message = errorMessage(error);
      const why = REFUSALS.find((known) => known === message);
      setFailure(
        why === undefined
          ? { message: t("common.error", { message }), retry: depth }
          : { message: t(`books.chapter.refusal.${why}`), retry: null },
      );
    } finally {
      setPreparing(false);
    }
  };

  /** Marks a word as known already, or takes that back. */
  const setKnown = async (word: BookWord, known: boolean): Promise<void> => {
    setFailure(null);
    try {
      const found = await setWordKnown(word.id, known);
      setWords(found.words);
      onPrepared(found.chapter);
    } catch (error) {
      const message = errorMessage(error);
      setFailure({ message: t("common.error", { message }), retry: null });
    }
  };

  /** A sitting on the chapter: it takes the whole window. */
  const sit = (kind: "practice" | "refresh" | "triage"): void => {
    navigate({
      name: "books",
      bookId: book.id,
      chapterId: chapter.id,
      practising: true,
      refresh: kind === "refresh",
      triage: kind === "triage",
    });
  };

  const deeper = deeperThan(chapter.prepared);
  const open = words?.some((word) => !word.done && !word.known) ?? false;
  // The words are read anew on the way in, the chapter a moment later: a
  // chapter with a word to practise is not ready, whatever it said before.
  const ready =
    chapter.readiness === READY && (words?.length ?? 0) > 0 && !open;
  // A word the learner knows already is not asked, in the refresh either.
  const refreshable =
    ready && (words?.some((word) => word.done && !word.known) ?? false);

  return (
    <div className="flex flex-col gap-6">
      <Reveal as="aside" index={1}>
        <ChapterAside
          words={words}
          preparing={preparing}
          prepared={chapter.prepared !== null}
          open={open}
          ready={ready}
          refreshable={refreshable}
          readying={readying}
          writing={writing}
          onPractise={() => {
            sit("practice");
          }}
          onRefresh={() => {
            sit("refresh");
          }}
        />
      </Reveal>
      <Reveal index={2} className="flex min-w-0 flex-1 flex-col gap-6">
        <Presence>
          {unwritten !== null && (
            <Reveal key="unwritten">
              <Notice tone="neutral">
                {t("books.sentences.failed", { message: unwritten })}
              </Notice>
            </Reveal>
          )}
          {failure !== null && (
            <Reveal key="failure" className="flex flex-col items-start gap-4">
              <Notice tone="danger">{failure.message}</Notice>
              <Presence>
                {failure.retry !== null && !preparing && (
                  <Reveal key="retry" as="span" kind="fade">
                    <Button
                      variant="primaryBook"
                      onClick={() => {
                        if (failure.retry !== null) {
                          void prepare(failure.retry);
                        }
                      }}
                    >
                      {t("common.retry")}
                    </Button>
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          )}
          {preparing && (
            <Reveal
              key="preparing"
              aria-live="polite"
              className="flex flex-col gap-4 text-ink-soft"
            >
              <p className="flex items-center gap-3">
                <Spinner />
                {t("books.chapter.preparing")}
              </p>
              <Presence>
                {progress !== null && (
                  <Reveal key="progress">
                    <PreparingBar progress={progress} />
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          )}
          {!preparing && words === null && (
            <Reveal key="loading" kind="fade">
              <Spinner />
            </Reveal>
          )}
          {!preparing && chapter.prepared !== null && words !== null && (
            <Reveal key="words" className="flex flex-col gap-6">
              <WordList
                words={words}
                onKnown={(word, known) => void setKnown(word, known)}
                onTriage={
                  open
                    ? () => {
                        sit("triage");
                      }
                    : undefined
                }
              />
            </Reveal>
          )}
          {!preparing && deeper.length > 0 && (
            <Reveal
              key="deeper"
              className="flex flex-col gap-4 border-t border-line pt-6"
            >
              <header className="flex flex-col gap-1">
                <h2 className="font-display font-medium tracking-tight text-ink">
                  {chapter.prepared === null
                    ? t("books.chapter.choose")
                    : t("books.chapter.more")}
                </h2>
                <p className="text-sm text-ink-soft">
                  {chapter.prepared === null
                    ? t("books.chapter.chooseHint")
                    : t("books.chapter.moreHint")}
                </p>
              </header>
              <DepthChoice
                depths={deeper}
                onChoose={(depth) => void prepare(depth)}
              />
            </Reveal>
          )}
        </Presence>
      </Reveal>
    </div>
  );
}
