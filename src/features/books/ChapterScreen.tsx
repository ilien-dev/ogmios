import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight, CircleCheck } from "lucide-react";
import type {
  Book,
  BookWord,
  Chapter,
  ChapterProgress,
  ChapterRefusal,
  Depth,
} from "@shared/domain";
import { READY } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import {
  getChapterWords,
  onChapterProgress,
  prepareChapter,
  setWordKnown,
} from "@/lib/ipc";
import { chapterName } from "./chapterName";
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

interface DepthChoiceProps {
  depths: readonly Depth[];
  onChoose: (depth: Depth) => void;
}

/** The depths on offer, each with what it means in one line. */
function DepthChoice({ depths, onChoose }: DepthChoiceProps): ReactNode {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {depths.map((depth) => (
        <li key={depth}>
          <button
            type="button"
            onClick={() => {
              onChoose(depth);
            }}
            className="group flex w-full items-center gap-4 px-2 py-4 text-left hover:bg-raised"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium text-ink">
                {t(`books.chapter.depth.${depth}.name`)}
              </span>
              <span className="text-sm text-ink-soft">
                {t(`books.chapter.depth.${depth}.hint`)}
              </span>
            </span>
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
            />
          </button>
        </li>
      ))}
    </ul>
  );
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
      <div className="mx-auto flex max-w-2xl flex-col gap-12 px-10 py-16">
        <header className="flex flex-col gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 self-start"
            icon={<ArrowLeft aria-hidden className="size-4" />}
            onClick={onBack}
          >
            {book.title}
          </Button>
          <h1 className="text-display font-semibold text-ink">
            {chapterName(chapter, t)}
          </h1>
        </header>

        {failure !== null && (
          <section className="flex flex-col items-start gap-4">
            <Notice tone="danger">{failure.message}</Notice>
            {failure.retry !== null && !preparing && (
              <Button
                variant="primary"
                onClick={() => {
                  if (failure.retry !== null) {
                    void prepare(failure.retry);
                  }
                }}
              >
                {t("common.retry")}
              </Button>
            )}
          </section>
        )}

        {preparing && (
          <section
            aria-live="polite"
            className="flex flex-col gap-4 text-ink-soft"
          >
            <p className="flex items-center gap-3">
              <Spinner />
              {t("books.chapter.preparing")}
            </p>
            {progress !== null && (
              <>
                <div
                  role="progressbar"
                  aria-label={t("books.chapter.preparing")}
                  aria-valuemin={0}
                  aria-valuenow={progress.done}
                  aria-valuemax={progress.total}
                  className="flex h-2 gap-1"
                >
                  {Array.from({ length: progress.total }, (_, piece) => (
                    <span
                      key={piece}
                      className={cn(
                        "flex-1 rounded-full transition-colors duration-150",
                        piece < progress.done ? "bg-accent-strong" : "bg-line",
                      )}
                    />
                  ))}
                </div>
                <p className="text-sm text-ink-faint tabular-nums">
                  {t("books.chapter.progress", {
                    done: progress.done,
                    total: progress.total,
                  })}
                </p>
              </>
            )}
          </section>
        )}

        {!preparing && words === null && <Spinner />}

        {!preparing && chapter.prepared !== null && words !== null && (
          <section className="flex flex-col items-start gap-8">
            {open && (
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" size="lg" onClick={onPractise}>
                  {t("books.chapter.practise")}
                </Button>
                <Button size="lg" onClick={onTriage}>
                  {t("books.triage.start")}
                </Button>
              </div>
            )}
            {ready && (
              <div className="flex flex-col items-start gap-4">
                <p className="flex items-center gap-2 text-lead font-medium text-accent-text">
                  <CircleCheck aria-hidden className="size-5" />
                  {t("books.ready")}
                </p>
                {refreshable && (
                  <Button onClick={onRefresh}>
                    {t("books.refresh.start")}
                  </Button>
                )}
              </div>
            )}
            <WordList
              words={words}
              onKnown={(word, known) => void setKnown(word, known)}
            />
          </section>
        )}

        {!preparing && deeper.length > 0 && (
          <section className="flex flex-col gap-4">
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
          </section>
        )}
      </div>
    </main>
  );
}
