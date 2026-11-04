import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  Book,
  BookWord,
  Chapter,
  KnownWord,
  RecallState,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import type { Entry } from "@/app/places";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { getChapterWords, listKnownWords, recallState } from "@/lib/ipc";
import { EASE_OUT, animated, staggerDelay } from "@/lib/motion";
import { BookCover } from "./BookCover";
import { PANEL, Review, Translate, Words } from "./BookHomePanels";
import { barState, chapterWindow } from "./chapterChart";
import type { BarState } from "./chapterChart";
import { chapterName } from "./chapterName";
import type { Current } from "./currentChapter";

/** How many chapters the chart has room for. */
const BARS = 12;
/** How many of a chapter's words show under the chart. */
const CHIPS = 8;

const FILL: Record<BarState, string> = {
  ready: "bg-book",
  learning: "bg-tally-fill",
  unprepared: "",
};

interface ChartProps {
  book: Book;
  selected: Chapter;
  onSelect: (chapter: Chapter) => void;
}

/** The chapters around the current one: how long each is, how ready. */
function Chart({ book, selected, onSelect }: ChartProps): ReactNode {
  const { t } = useTranslation();
  const reduced = useReducedMotionConfig() === true;
  const shown = chapterWindow(book.chapters, selected.id, BARS);
  const longest = Math.max(1, ...shown.map((chapter) => chapter.words));

  return (
    <div className="flex min-h-48 flex-1 items-end gap-2">
      {shown.map((chapter, index) => {
        const state = barState(chapter);
        const on = chapter.id === selected.id;
        const height = 25 + Math.round((chapter.words / longest) * 75);
        return (
          <button
            key={chapter.id}
            type="button"
            aria-pressed={on}
            aria-label={t(`bookHome.bar.${state}`, {
              chapter: chapterName(chapter, t),
              words: chapter.words,
              readiness: chapter.readiness ?? 0,
            })}
            onClick={() => {
              onSelect(chapter);
            }}
            className="group flex h-48 min-w-0 flex-1 flex-col items-center justify-end gap-2"
          >
            <motion.span
              initial={animated() && !reduced ? { scaleY: 0 } : false}
              animate={{ scaleY: 1 }}
              transition={{
                duration: 0.7,
                ease: EASE_OUT,
                delay: staggerDelay(index),
              }}
              style={{ height: `${String(height)}%` }}
              className={cn(
                "relative w-full origin-bottom overflow-hidden rounded-sm transition-control",
                state === "unprepared"
                  ? "border border-dashed border-line-strong"
                  : "bg-raised",
                on
                  ? "outline-2 outline-offset-2 outline-ink"
                  : "group-hover:outline-2 group-hover:outline-offset-2 group-hover:outline-line-strong",
              )}
            >
              <motion.span
                initial={false}
                animate={{ height: `${String(chapter.readiness ?? 0)}%` }}
                transition={{ duration: 0.5, ease: EASE_OUT }}
                className={cn("absolute inset-x-0 bottom-0", FILL[state])}
              />
            </motion.span>
            <span
              className={cn(
                "text-xs",
                on ? "font-semibold text-ink" : "text-ink-faint",
              )}
            >
              {chapter.index + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Legend(): ReactNode {
  const { t } = useTranslation();
  const keys: Array<[BarState, string]> = [
    ["ready", "bg-book"],
    ["learning", "bg-tally-fill"],
    ["unprepared", "border border-dashed border-line-strong"],
  ];
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-ink-soft">
      {keys.map(([key, swatch]) => (
        <li key={key} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-sm", swatch)} />
          {t(`bookHome.legend.${key}`)}
        </li>
      ))}
    </ul>
  );
}

interface SelectedProps {
  book: Book;
  chapter: Chapter;
  navigate: Navigate;
}

/** The chapter picked on the chart: the words it still asks for, and the way in. */
function Selected({ book, chapter, navigate }: SelectedProps): ReactNode {
  const { t } = useTranslation();
  const [words, setWords] = useState<BookWord[] | null>(null);
  const state = barState(chapter);

  useEffect(() => {
    let live = true;
    setWords(null);
    if (chapter.readiness === null) {
      return;
    }
    getChapterWords(chapter.id)
      .then((found) => {
        if (live) {
          setWords(
            [...found.words.filter((word) => !word.done && !word.known)]
              .sort((a, b) => b.count - a.count)
              .slice(0, CHIPS),
          );
        }
      })
      // Without them the chapter still opens: only the preview is missing.
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [chapter.id, chapter.readiness]);

  return (
    <div className="flex flex-col gap-3 rounded-md bg-sunken p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">
          {chapterName(chapter, t)}
        </h3>
        <p className="text-sm text-ink-soft">
          {t(`bookHome.state.${state}`, { readiness: chapter.readiness ?? 0 })}
        </p>
      </div>
      <Presence>
        {words !== null && words.length > 0 && (
          <Reveal
            key="words"
            as="ul"
            kind="fade"
            className="flex flex-wrap gap-1.5"
          >
            {words.map((word, index) => (
              <Reveal
                key={word.id}
                as="li"
                kind="rise"
                index={index}
                className="rounded-sm bg-surface px-2.5 py-1 font-serif text-base text-book-ink"
              >
                {word.lemma}
              </Reveal>
            ))}
          </Reveal>
        )}
      </Presence>
      <Button
        variant="primaryBook"
        className="self-start"
        onClick={() => {
          navigate({ name: "books", bookId: book.id, chapterId: chapter.id });
        }}
      >
        {t(state === "unprepared" ? "bookHome.prepare" : "bookHome.study")}
      </Button>
    </div>
  );
}

interface DashboardProps {
  book: Book;
  selected: Chapter;
  /** The current chapter's place in the book, from 1. */
  at: number;
  /** Words the daily recall asks today. */
  due: number;
  recall: RecallState | null;
  learned: number;
  known: number;
  nativeLang: string;
  navigate: Navigate;
  onPick: (chapterId: string) => void;
}

function Dashboard({
  book,
  selected,
  at,
  due,
  recall,
  learned,
  known,
  nativeLang,
  navigate,
  onPick,
}: DashboardProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-2 pb-10 nav:px-10">
      <Reveal as="header" kind="fade" className="flex items-center gap-4">
        <BookCover book={book} className="w-11" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-medium tracking-tight text-ink">
            {book.title}
          </h1>
          <div className="mt-1 flex items-center gap-3">
            <p className="shrink-0 text-sm text-ink-soft">
              {t("bookHome.position", { at, of: book.chapters.length })}
            </p>
            <div
              aria-hidden
              className="h-1 w-full max-w-60 overflow-hidden rounded-full bg-line"
            >
              <motion.div
                initial={animated() ? { scaleX: 0 } : false}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.15 }}
                style={{
                  width: `${String((at / book.chapters.length) * 100)}%`,
                }}
                className="h-full origin-left bg-book"
              />
            </div>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            navigate({ name: "books", bookId: null });
          }}
        >
          {t("bookHome.shelf")}
        </Button>
      </Reveal>

      <Stagger className="grid grid-cols-1 gap-4 nav:grid-cols-4">
        <Reveal
          as="section"
          aria-labelledby="book-home-chapters"
          className={cn(
            PANEL,
            "flex flex-col gap-4 nav:col-span-2 nav:row-span-2",
          )}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2
              id="book-home-chapters"
              className="text-lg font-semibold text-ink"
            >
              {t("bookHome.chapters.title")}
            </h2>
            <p className="text-xs text-ink-faint">
              {t("bookHome.chapters.hint")}
            </p>
          </div>
          <Chart
            book={book}
            selected={selected}
            onSelect={(chapter) => {
              onPick(chapter.id);
            }}
          />
          <Legend />
          <Selected book={book} chapter={selected} navigate={navigate} />
        </Reveal>
        <Reveal className="flex nav:col-span-2">
          <Translate
            book={book}
            chapter={selected}
            nativeLang={nativeLang}
            navigate={navigate}
          />
        </Reveal>
        <Reveal className="flex">
          <Review due={due} state={recall} navigate={navigate} />
        </Reveal>
        <Reveal className="flex">
          <Words learned={learned} known={known} />
        </Reveal>
      </Stagger>
    </div>
  );
}

interface BookHomeProps {
  /** The shelf has been read: until then, no book is not yet no books. */
  loaded: boolean;
  books: readonly Book[];
  /** The chapter the learner is on. */
  current: Current | null;
  /** What is due today, by place. */
  counts: Partial<Record<Entry, number>>;
  nativeLang: string;
  navigate: Navigate;
}

/**
 * The book section's own screen: the chapters around the current one with
 * how ready each is, then translating it, today's review and every word the
 * learner has. Each is one press from what it shows.
 */
export function BookHome({
  loaded,
  books,
  current,
  counts,
  nativeLang,
  navigate,
}: BookHomeProps): ReactNode {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const [recall, setRecall] = useState<RecallState | null>(null);
  const [known, setKnown] = useState<KnownWord[] | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([recallState(), listKnownWords()])
      .then(([state, words]) => {
        if (live) {
          setRecall(state);
          setKnown(words);
        }
      })
      // Without them the chart still works: only the counts are missing.
      .catch(() => null);
    return () => {
      live = false;
    };
  }, []);

  const book = current?.book ?? books.find((one) => one.chapters.length > 0);
  const selected =
    book?.chapters.find((chapter) => chapter.id === picked) ??
    (current !== null && current.book.id === book?.id
      ? current.chapter
      : book?.chapters[0]);
  const learned =
    recall === null ? 0 : recall.fresh + recall.settling + recall.firm;

  return (
    <Presence swap>
      {book !== undefined && selected !== undefined ? (
        <Reveal
          key="loaded"
          as="main"
          kind="fade"
          className="h-full overflow-y-auto"
        >
          <Dashboard
            book={book}
            selected={selected}
            at={(current?.chapter.index ?? 0) + 1}
            due={counts.recall ?? 0}
            recall={recall}
            learned={learned}
            known={known?.length ?? 0}
            nativeLang={nativeLang}
            navigate={navigate}
            onPick={setPicked}
          />
        </Reveal>
      ) : loaded ? (
        <Reveal
          key="empty"
          as="main"
          kind="fade"
          className="grid h-full place-items-center p-8"
        >
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <h1 className="text-title font-light text-ink">
              {t("bookHome.empty.title")}
            </h1>
            <p className="text-ink-soft">{t("bookHome.empty.body")}</p>
            <Button
              variant="primaryBook"
              onClick={() => {
                navigate({ name: "books", bookId: null });
              }}
            >
              {t("bookHome.empty.action")}
            </Button>
          </div>
        </Reveal>
      ) : (
        <Reveal
          key="loading"
          as="main"
          kind="fade"
          className="grid h-full place-items-center"
        >
          <Spinner />
        </Reveal>
      )}
    </Presence>
  );
}
