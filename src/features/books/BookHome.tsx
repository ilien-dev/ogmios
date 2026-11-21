import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Swap } from "@/components/motion/Swap";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import type { BookTab, Navigate } from "@/app/routes";
import { ListenTab } from "@/features/listening/ListenTab";
import { WriteTab } from "@/features/structures/WriteTab";
import { BookBoard } from "./BookHomeBoard";
import { BookScene } from "./BookHomeScene";
import { ChapterHead } from "./ChapterHead";
import { ChapterScreen } from "./ChapterScreen";
import { chapterName } from "./chapterName";
import type { Current } from "./currentChapter";
import { TranslateTab } from "./TranslateTab";

interface LoadedProps {
  book: Book;
  /** The chapter the learner is on. */
  selected: Chapter;
  tab: BookTab;
  nativeLang: string;
  navigate: Navigate;
  onPick: (chapterId: string) => void;
  /** The chapter as it stands once its words changed under this screen. */
  onChanged: (chapter: Chapter) => void;
}

/**
 * The column of glass on the left, then the chapter's panel and the scene of
 * the book side by side when the window is wide enough: the panel holds the
 * tabs, the chapter they work on and what the picked one does with it. On a
 * narrower window the panel goes under the scene.
 */
function Loaded({
  book,
  selected,
  tab,
  nativeLang,
  navigate,
  onPick,
  onChanged,
}: LoadedProps): ReactNode {
  const { t } = useTranslation();
  /** The chapter a row of the list points at: its block rises in the scene. */
  const [pointed, setPointed] = useState<string | null>(null);
  return (
    <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row">
      <div className="scrollbar-none flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md wide:overflow-y-auto wide:pb-2">
        <BookBoard
          book={book}
          selected={selected}
          onPick={onPick}
          onPoint={setPointed}
        />
      </div>
      <Stagger className="scrollbar-none flex min-w-0 flex-1 flex-col gap-4 wide:overflow-y-auto wide:pb-2 split:flex-row split:overflow-visible split:pb-0">
        <BookScene
          book={book}
          selected={selected}
          pointed={pointed}
          navigate={navigate}
          onPick={onPick}
          className="min-h-192 shrink-0 split:min-h-0 split:flex-1 split:basis-0"
        />
        <Reveal
          as="section"
          aria-label={t("bookHome.tabs.panel", {
            tab: t(`bookHome.tabs.${tab}`),
            chapter: chapterName(selected, t),
          })}
          className="@container relative scrollbar-none flex flex-col gap-6 rounded-2xl glass p-6 nav:p-8 split:order-first split:flex-1 split:basis-0 split:overflow-y-auto"
        >
          <ChapterHead
            book={book}
            chapter={selected}
            tab={tab}
            navigate={navigate}
            onPick={onPick}
          />
          <Swap id={`${selected.id}-${tab}`} as="div">
            {tab === "words" ? (
              <ChapterScreen
                book={book}
                chapter={selected}
                onPrepared={onChanged}
                navigate={navigate}
              />
            ) : tab === "listen" ? (
              <ListenTab chapterId={selected.id} navigate={navigate} />
            ) : tab === "translate" ? (
              <TranslateTab
                book={book}
                chapter={selected}
                nativeLang={nativeLang}
                navigate={navigate}
              />
            ) : (
              <WriteTab
                chapterId={selected.id}
                prepared={selected.prepared !== null}
                navigate={navigate}
              />
            )}
          </Swap>
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
  /** What is being done with that chapter. */
  tab: BookTab;
  nativeLang: string;
  navigate: Navigate;
  /** Makes a chapter the one the learner is on. */
  onPick: (chapterId: string) => void;
}

/**
 * The book: its chapters by bar, by name and raised as a relief, the one the
 * learner is on lit, and the four things done with that chapter as tabs
 * atop the panel they change. A chapter is picked here and nowhere else, by any of the
 * three; picking another keeps the tab.
 */
export function BookHome({
  loaded,
  books,
  current,
  tab,
  nativeLang,
  navigate,
  onPick,
}: BookHomeProps): ReactNode {
  const { t } = useTranslation();
  /** Chapters whose words changed here, as they stand now, by id. */
  const [changed, setChanged] = useState<ReadonlyMap<string, Chapter>>(
    new Map(),
  );

  const held = current?.book ?? books.find((one) => one.chapters.length > 0);
  const book =
    held === undefined
      ? undefined
      : {
          ...held,
          chapters: held.chapters.map(
            (chapter) => changed.get(chapter.id) ?? chapter,
          ),
        };
  const selected =
    book?.chapters.find((chapter) => chapter.id === current?.chapter.id) ??
    book?.chapters[0];

  return (
    <Presence swap>
      {book !== undefined && selected !== undefined ? (
        <Reveal
          key="loaded"
          as="main"
          kind="fade"
          layoutScroll
          className="h-full overflow-y-auto"
        >
          <Loaded
            book={book}
            selected={selected}
            tab={tab}
            nativeLang={nativeLang}
            navigate={navigate}
            onPick={onPick}
            onChanged={(chapter) => {
              setChanged((before) => new Map(before).set(chapter.id, chapter));
            }}
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
            <h1 className="font-display text-title font-light tracking-tight text-ink">
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
