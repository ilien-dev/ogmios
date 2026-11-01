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
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
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
import { chapterName } from "./chapterName";
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
  onBack: () => void;
  /** The chapter as it is once its words are in, or stand differently. */
  onPrepared: (chapter: Chapter) => void;
  /** Starts a sitting on the chapter's words. */
  onPractise: () => void;
  /** Starts sorting the open words into known and not, a card each. */
  onTriage: () => void;
  /** Starts the quick refresh of a chapter that is ready to read. */
  onRefresh: () => void;
  /** Starts translating the chapter, whatever its words stand at. */
  onTranslate: () => void;
  /** Opens the structures the chapter uses most, to practise them. */
  onStructures: () => void;
}

/**
 * One chapter: the choice of how many words to learn, the reading of the
 * chapter, and then its word list with the way into practising it. A word
 * the learner knows already is set aside there, and can be taken back. A
 * chapter that is ready to read offers a quick refresh of its done words.
 */
export function ChapterScreen({
  book,
  chapter,
  onBack,
  onPrepared,
  onPractise,
  onTriage,
  onRefresh,
  onTranslate,
  onStructures,
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

  // The sentence each of its words is asked with is glossed in the
  // background, once it is prepared and again whenever it is opened: a word
  // never given one gets it. A failure is quiet: the words are asked as the
  // chapter has them meanwhile.
  const [writing, setWriting] = useState<SentenceProgress | null>(null);
  const { prepared } = chapter;
  useEffect(() => {
    if (prepared === null) {
      return;
    }
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
    fill().catch(() => null);
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
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 nav:px-10 nav:py-12">
        <Reveal index={0}>
          <BackLink label={book.title} onClick={onBack} />
        </Reveal>
        <div className="flex flex-col gap-10 nav:flex-row nav:items-start nav:gap-12">
          <Reveal
            as="aside"
            index={1}
            className="nav:sticky nav:top-0 nav:w-80 nav:shrink-0"
          >
            <ChapterAside
              book={book}
              name={chapterName(chapter, t)}
              words={words}
              preparing={preparing}
              prepared={chapter.prepared !== null}
              open={open}
              ready={ready}
              refreshable={refreshable}
              onPractise={onPractise}
              onRefresh={onRefresh}
              onTranslate={onTranslate}
              onStructures={onStructures}
            />
          </Reveal>
          <Reveal index={2} className="flex min-w-0 flex-1 flex-col gap-6">
            <Presence>
              {failure !== null && (
                <Reveal
                  key="failure"
                  className="flex flex-col items-start gap-4"
                >
                  <Notice tone="danger">{failure.message}</Notice>
                  <Presence>
                    {failure.retry !== null && !preparing && (
                      <Reveal key="preparing" as="span" kind="fade">
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
                <Reveal
                  key="words"
                  className="flex flex-col gap-6 rounded-xl bg-surface p-6 shadow-card nav:p-8"
                >
                  <Presence>
                    {writing !== null && writing.done < writing.total && (
                      <Reveal
                        key="total"
                        className="flex w-full flex-col gap-2"
                      >
                        <p className="text-sm text-ink-faint">
                          {t("books.sentences.writing", {
                            done: writing.done,
                            total: writing.total,
                          })}
                        </p>
                        <ProgressBar
                          label={t("books.sentences.bar")}
                          value={writing.done}
                          total={writing.total}
                          tone="book"
                        />
                      </Reveal>
                    )}
                  </Presence>
                  <WordList
                    words={words}
                    onKnown={(word, known) => void setKnown(word, known)}
                    onTriage={open ? onTriage : undefined}
                  />
                </Reveal>
              )}
              {!preparing && deeper.length > 0 && (
                <Reveal
                  key="deeper"
                  className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-card nav:p-8"
                >
                  <header className="flex flex-col gap-1">
                    <h2 className="font-medium text-ink">
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
      </div>
    </main>
  );
}
