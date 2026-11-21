import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter, KnownWord, RecallState } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import type { Entry } from "@/app/places";
import type { Navigate } from "@/app/routes";
import { listKnownWords, recallState } from "@/lib/ipc";
import { BookBoard } from "./BookHomeBoard";
import { BookScene } from "./BookHomeScene";
import type { Current } from "./currentChapter";

interface LoadedProps {
  book: Book;
  selected: Chapter;
  /** Words the daily recall asks today. */
  due: number;
  recall: RecallState | null;
  learned: number;
  known: number;
  nativeLang: string;
  navigate: Navigate;
  onPick: (chapterId: string) => void;
}

/**
 * The column of glass on the left and the scene of the book on the right, as
 * in the brand proposal; one under the other when the window is narrow.
 */
function Loaded({
  book,
  selected,
  due,
  recall,
  learned,
  known,
  nativeLang,
  navigate,
  onPick,
}: LoadedProps): ReactNode {
  return (
    <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row">
      <div className="scrollbar-none flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md wide:overflow-y-auto wide:pb-2">
        <BookBoard
          book={book}
          selected={selected}
          words={learned + known}
          nativeLang={nativeLang}
          navigate={navigate}
          onPick={onPick}
        />
      </div>
      <Stagger className="flex min-h-160 min-w-0 flex-1 flex-col">
        <BookScene
          book={book}
          selected={selected}
          due={due}
          recall={recall}
          learned={learned}
          known={known}
          navigate={navigate}
          onPick={onPick}
          className="flex-1"
        />
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
 * how ready each is and the ways into the picked one, beside the book raised
 * as a relief of its chapters with today's review and every word the learner
 * has along its foot. Each is one press from what it shows.
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
          layoutScroll
          className="h-full overflow-y-auto"
        >
          <Loaded
            book={book}
            selected={selected}
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
