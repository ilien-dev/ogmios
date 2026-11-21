import { ArrowUpRight, BookOpen, Library } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, BookWord, Chapter } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Tilt } from "@/components/motion/Tilt";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { BigNumber } from "@/components/scene/Stats";
import type { BookTab, Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { getChapterWords } from "@/lib/ipc";
import { BookCover } from "./BookCover";
import { BARS } from "./BookHomeBoard";
import { ChapterTabs } from "./ChapterTabs";
import { ChapterRelief } from "./ChapterRelief";
import { barState, chapterWindow } from "./chapterChart";
import { chapterName } from "./chapterName";

/** How many of a chapter's words its card over the scene names. */
const CHIPS = 5;

/** The words the chapter still asks for, the most frequent first. */
function useOpenWords(chapter: Chapter): BookWord[] | null {
  const [words, setWords] = useState<BookWord[] | null>(null);
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
      // Without them the card still stands: only the preview is missing.
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [chapter.id, chapter.readiness]);
  return words;
}

/**
 * The glass floating over the picked block: how ready it is, how long. It
 * stays while another chapter is picked: its words cross-fade and its number
 * counts from the last chapter's to the new one's.
 */
function Tooltip({
  book,
  chapter,
}: {
  book: Book;
  chapter: Chapter;
}): ReactNode {
  const { t } = useTranslation();
  const words = useOpenWords(chapter);
  const next = book.chapters[chapter.index + 1];
  const state = barState(chapter);
  return (
    <Reveal
      kind="scale"
      className="absolute top-36 right-7 z-10 flex w-64 flex-col gap-1.5 rounded-xl glass-float px-4.5 py-4"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="relative min-w-0 flex-1">
          <Swap
            id={chapter.id}
            as="div"
            className="line-clamp-2 font-display text-base font-semibold tracking-tight text-ink"
          >
            {chapterName(chapter, t)}
          </Swap>
        </span>
        <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
      </span>
      <Presence>
        {next !== undefined && (
          <Reveal
            key="next"
            as="span"
            kind="fade"
            className="relative truncate text-sm text-ink-faint"
          >
            <Swap id={next.id} as="div" className="truncate">
              {t("bookHome.board.next", { chapter: chapterName(next, t) })}
            </Swap>
          </Reveal>
        )}
      </Presence>
      <Presence swap>
        {state === "unprepared" ? (
          <Reveal
            key="unprepared"
            as="span"
            kind="fade"
            className="py-1 text-sm text-ink-soft"
          >
            {t("bookHome.state.unprepared")}
          </Reveal>
        ) : (
          <Reveal key="readiness" as="span" kind="fade">
            <BigNumber
              value={chapter.readiness ?? 0}
              size="md"
              unit={t("bookHome.board.readyUnit")}
              className={cn(
                "transition-control",
                state === "ready" ? "text-book" : "text-accent-text",
              )}
            />
          </Reveal>
        )}
      </Presence>
      <span className="relative text-sm text-ink-faint">
        <Swap id={String(chapter.words)}>
          {t("bookHome.board.length", { count: chapter.words })}
        </Swap>
      </span>
      <Presence>
        {words !== null && words.length > 0 && (
          <Reveal
            key="words"
            kind="fade"
            className="flex flex-col gap-1.5 pt-1"
          >
            <span className="font-mono text-xs tracking-wider text-ink-faint uppercase">
              {t("bookHome.board.toLearn")}
            </span>
            <ul className="flex flex-wrap gap-1">
              {words.map((word, index) => (
                <Reveal
                  key={word.id}
                  as="li"
                  kind="rise"
                  index={index}
                  className="rounded-full bg-book-soft px-2.5 py-0.5 text-sm font-medium text-book-ink"
                >
                  {word.lemma}
                </Reveal>
              ))}
            </ul>
          </Reveal>
        )}
      </Presence>
    </Reveal>
  );
}

interface BookSceneProps {
  book: Book;
  /** The chapter the learner is on. */
  selected: Chapter;
  /** What is being done with it. */
  tab: BookTab;
  /** The chapter a row of the list points at: its block rises. */
  pointed: string | null;
  navigate: Navigate;
  /** Picks a chapter: a block of the relief does it as its bar does. */
  onPick: (chapterId: string) => void;
  className?: string;
}

/**
 * The scene of the book: its title, its chapters raised as blocks as tall
 * as they are ready with the one the learner is on lit, and along the bottom
 * the four things done with that chapter, as tabs.
 */
export function BookScene({
  book,
  selected,
  tab,
  pointed,
  navigate,
  onPick,
  className,
}: BookSceneProps): ReactNode {
  const { t } = useTranslation();
  const count = book.chapters.length;
  const about = t("bookHome.board.chapters", { count });
  return (
    <Scene
      label={book.title}
      zoom
      className={className}
      header={
        <>
          <div className="flex items-center gap-5">
            <Tilt className="shrink-0">
              <BookCover
                book={book}
                className="w-16 -rotate-3 transition-transform duration-500 ease-out-expo hover:rotate-0 wide:w-20"
              />
            </Tilt>
            <SceneTitle>{book.title}</SceneTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex h-10 max-w-full items-center gap-2 rounded-full glass px-4 text-sm text-ink-soft">
              <BookOpen aria-hidden className="size-4 shrink-0" />
              <span className="truncate">
                {book.author === null ? "" : `${book.author} · `}
                <span className="font-mono text-ink">{count}</span> {about}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                navigate({ name: "books", bookId: null });
              }}
              className="group inline-flex h-10 items-center gap-2 rounded-full glass px-4 text-sm text-ink transition-control hover:shadow-lift"
            >
              <Library
                aria-hidden
                className="size-4 transition-transform duration-300 ease-out-expo group-hover:-rotate-6"
              />
              {t("bookHome.shelf")}
            </button>
          </div>
        </>
      }
      overlay={<Tooltip book={book} chapter={selected} />}
      footer={<ChapterTabs chapter={selected} tab={tab} navigate={navigate} />}
    >
      <ChapterRelief
        chapters={chapterWindow(book.chapters, selected.id, BARS)}
        selectedId={selected.id}
        pointed={pointed}
        onSelect={onPick}
        label={t("bookHome.board.relief")}
        className="size-full max-w-4xl pt-40 pr-72 pb-32 pl-6"
      />
    </Scene>
  );
}
