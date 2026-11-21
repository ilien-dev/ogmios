import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { Book, Chapter } from "@shared/domain";
import type { BookTab, Route } from "@/app/routes";
import { showsNav } from "@/app/routes";
import { BooksScreen } from "@/features/books/BooksScreen";
import { ChapterHead } from "@/features/books/ChapterHead";
import { ChapterScreen } from "@/features/books/ChapterScreen";
import { currentOf } from "@/features/books/currentChapter";
import { TranslateTab } from "@/features/books/TranslateTab";
import { listBooks } from "@/lib/ipc";

interface BookSectionProps {
  /** The chapter the learner is on; without one it opens on the book's page. */
  chapterId?: string;
  /** The tab of the chapter it opens on. */
  tab?: BookTab;
  bookId?: string;
}

/**
 * For tests: the book as the app holds it, without the scene around it. The
 * chapter the learner is on, its head and tabs, with its words or its
 * translation, the library's
 * page of a book, and whatever takes the whole window on a chapter; a move
 * anywhere else says where it left for.
 */
export function BookSection({
  chapterId,
  tab = "words",
  bookId = "book-alice",
}: BookSectionProps): ReactNode {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [on, setOn] = useState<string | null>(chapterId ?? null);
  const [route, setRoute] = useState<Route>(
    chapterId === undefined ? { name: "books", bookId } : { name: "book", tab },
  );

  useEffect(() => {
    let live = true;
    void listBooks().then((read) => {
      if (live) {
        setBooks(read);
      }
    });
    return () => {
      live = false;
    };
  }, [route]);

  if (books === null) {
    return null;
  }
  const nav = showsNav(route) ? <nav aria-label="Places" /> : null;
  if (route.name === "books") {
    return (
      <>
        {nav}
        <BooksScreen
          nativeLang="es"
          shelf={books}
          bookId={route.bookId}
          chapterId={route.chapterId ?? null}
          practising={route.practising === true}
          refresh={route.refresh === true}
          triage={route.triage === true}
          translating={route.translating ?? null}
          navigate={setRoute}
          onPick={setOn}
        />
      </>
    );
  }
  const current = currentOf(books, on);
  if (route.name !== "book" || current === null) {
    return <p>{`Left for ${route.name}`}</p>;
  }
  const replace = (changed: Chapter): void => {
    setBooks(
      books.map((book) => ({
        ...book,
        chapters: book.chapters.map((chapter) =>
          chapter.id === changed.id ? changed : chapter,
        ),
      })),
    );
  };
  return (
    <>
      {nav}
      <button
        type="button"
        onClick={() => {
          setRoute({ name: "books", bookId: current.book.id });
        }}
      >
        {current.book.title}
      </button>
      <ChapterHead
        book={current.book}
        chapter={current.chapter}
        tab={route.tab ?? "words"}
        navigate={setRoute}
        onPick={setOn}
      />
      {(route.tab ?? "words") === "translate" ? (
        <TranslateTab
          book={current.book}
          chapter={current.chapter}
          nativeLang="es"
          navigate={setRoute}
        />
      ) : (
        <ChapterScreen
          key={current.chapter.id}
          book={current.book}
          chapter={current.chapter}
          onPrepared={replace}
          navigate={setRoute}
        />
      )}
    </>
  );
}
