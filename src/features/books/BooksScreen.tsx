import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Book, BookRefusal, Chapter, Translation } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import { importBook, listBooks, listKnownWords, pickBookFile } from "@/lib/ipc";
import { BookDetail } from "./BookDetail";
import { BookShelf } from "./BookShelf";
import { SittingScreen } from "./SittingScreen";
import { TranslateScreen } from "./TranslateScreen";
import { TriageRun } from "./TriageRun";

const REFUSALS: readonly BookRefusal[] = ["drm", "unreadable", "scanned"];

/** The book with one of its chapters replaced; other books come back as is. */
function withChapter(book: Book, changed: Chapter): Book {
  if (!book.chapters.some((chapter) => chapter.id === changed.id)) {
    return book;
  }
  return {
    ...book,
    chapters: book.chapters.map((chapter) =>
      chapter.id === changed.id ? changed : chapter,
    ),
  };
}

/**
 * What the app holds, if it can stand in for the first read: nothing held
 * yet is not an empty shelf, and a shelf without the open book (just added)
 * would say it is gone.
 */
function seeded(
  shelf: Book[] | undefined,
  bookId: string | null,
): Book[] | null {
  if (shelf === undefined || shelf.length === 0) {
    return null;
  }
  if (bookId !== null && !shelf.some((book) => book.id === bookId)) {
    return null;
  }
  return shelf;
}

interface BooksScreenProps {
  /** The learner's first language: the other half of every word asked. */
  nativeLang: string;
  /**
   * The books the app already holds: they show at once while the screen reads
   * them again, so that a move between shelf, book and chapter has no blank
   * frame.
   */
  shelf?: Book[];
  /** The open book; null shows the shelf. */
  bookId: string | null;
  /** The chapter a sitting is on; null shows the book. */
  chapterId: string | null;
  /** A sitting on that chapter is running. */
  practising?: boolean;
  /** That sitting is the warm-up before reading. */
  refresh?: boolean;
  /** That sitting sorts the chapter's words into known and not. */
  triage?: boolean;
  /** The attempt at translating that chapter that is on the screen. */
  translating?: Translation | null;
  navigate: Navigate;
  /** Makes a chapter the one the learner is on. */
  onPick: (chapterId: string) => void;
}

/**
 * The library and what takes the whole window on a chapter: the shelf of
 * uploaded books with the way to add one, a book with its chapters to name
 * them or delete it, and a sitting or a translation of the chapter the
 * learner is on. A chapter picked here is opened in the book's own screen.
 */
export function BooksScreen({
  nativeLang,
  shelf,
  bookId,
  chapterId,
  practising = false,
  refresh = false,
  triage = false,
  translating = null,
  navigate,
  onPick,
}: BooksScreenProps): ReactNode {
  const { t } = useTranslation();
  const [books, setBooks] = useState<Book[] | null>(() =>
    seeded(shelf, bookId),
  );
  const [knownCount, setKnownCount] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listBooks(), listKnownWords()])
      .then(([loaded, words]) => {
        if (live) {
          setBooks(loaded);
          setKnownCount(words.length);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    return () => {
      live = false;
    };
    // Read again at every move: a sitting, or a word marked as known, changes
    // how ready chapters are, in this book and in the others.
  }, [bookId, chapterId, practising]);

  const showShelf = (): void => {
    navigate({ name: "books", bookId: null });
  };

  const add = async (): Promise<void> => {
    setRefusal(null);
    try {
      const path = await pickBookFile(t("books.fileType"));
      if (path === null) {
        return;
      }
      setAdding(true);
      const added = await importBook(path);
      setBooks((current) => [
        added,
        ...(current ?? []).filter((book) => book.id !== added.id),
      ]);
      navigate({ name: "books", bookId: added.id });
    } catch (error) {
      const message = errorMessage(error);
      const why = REFUSALS.find((each) => each === message);
      setRefusal(
        why === undefined
          ? t("common.error", { message })
          : t(`books.refusal.${why}`),
      );
    } finally {
      setAdding(false);
    }
  };

  const view = (): ReactNode => {
    if (books === null) {
      return (
        <main className="grid h-full place-items-center">
          <Presence swap>
            {failure === null ? (
              <Reveal key="waiting" as="span" kind="fade">
                <Spinner />
              </Reveal>
            ) : (
              <Notice key="failure" tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            )}
          </Presence>
        </main>
      );
    }

    // A chapter can finish preparing after the shelf has changed under it.
    const replaceChapter = (changed: Chapter): void => {
      setBooks(
        (current) => current?.map((book) => withChapter(book, changed)) ?? null,
      );
    };
    const open = books.find((book) => book.id === bookId) ?? null;
    const chapter =
      open?.chapters.find((candidate) => candidate.id === chapterId) ?? null;

    if (open !== null && chapter !== null && practising) {
      const sit = (): void => {
        navigate({
          name: "books",
          bookId: open.id,
          chapterId: chapter.id,
          practising: true,
        });
      };
      const close = (): void => {
        navigate({ name: "book", tab: "words" });
      };
      if (triage) {
        return (
          <TriageRun
            key={chapter.id}
            chapterId={chapter.id}
            onPractise={sit}
            onDone={close}
          />
        );
      }
      return (
        <SittingScreen
          key={`${chapter.id}-${refresh ? "refresh" : "practice"}`}
          chapterId={chapter.id}
          nativeLang={nativeLang}
          refresh={refresh}
          onClose={close}
          onPractise={sit}
        />
      );
    }

    if (open !== null && chapter !== null && translating !== null) {
      return (
        <TranslateScreen
          key={translating.attemptId}
          attempt={translating}
          nativeLang={nativeLang}
          onBack={() => {
            navigate({ name: "book", tab: "translate" });
          }}
        />
      );
    }

    if (bookId !== null) {
      return (
        <BookDetail
          key={bookId}
          book={open}
          onBack={showShelf}
          onOpen={(opened) => {
            onPick(opened.id);
            navigate({ name: "book", tab: "words" });
          }}
          onRenamed={replaceChapter}
          onDeleted={() => {
            setBooks(books.filter((book) => book.id !== bookId));
            showShelf();
          }}
        />
      );
    }

    return (
      <BookShelf
        books={books}
        adding={adding}
        refusal={refusal}
        knownCount={knownCount}
        onAdd={() => void add()}
        navigate={navigate}
      />
    );
  };

  return (
    <Swap as="div" id={books === null ? "loading" : "ready"} className="h-full">
      {view()}
    </Swap>
  );
}
