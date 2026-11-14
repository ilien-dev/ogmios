import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Trash2 } from "lucide-react";
import type { ArchivedBook, Book, BookDeletion } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { errorMessage } from "@/lib/errors";
import { archivedBooks, bookDeletion, purgeBook } from "@/lib/ipc";
import { BookCover } from "./BookCover";
import { DeleteBookDialog } from "./DeleteBookDialog";

/** What the dialog is given before any book is chosen; it is never shown. */
const NOBODY: ArchivedBook = {
  id: "",
  title: "",
  author: null,
  opening: "",
  archivedAt: "",
  words: 0,
};

/** An archived book as a cover needs it: it has no chapters to show. */
function asBook(archived: ArchivedBook): Book {
  return {
    id: archived.id,
    title: archived.title,
    author: archived.author,
    opening: archived.opening,
    chapters: [],
  };
}

/**
 * The books deleted with their words kept. They no longer open; each says
 * how many of its words are still in the daily review, and can be deleted
 * for good.
 */
export function ArchivedShelf(): ReactNode {
  const { t } = useTranslation();
  const [books, setBooks] = useState<ArchivedBook[]>([]);
  const [chosen, setChosen] = useState<ArchivedBook | null>(null);
  const [open, setOpen] = useState(false);
  const [deletion, setDeletion] = useState<BookDeletion | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void archivedBooks().then((found) => {
      if (live) {
        setBooks(found);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const ask = async (book: ArchivedBook): Promise<void> => {
    setFailure(null);
    try {
      setDeletion(await bookDeletion(book.id));
      setChosen(book);
      setOpen(true);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const purge = async (): Promise<void> => {
    if (chosen === null) {
      return;
    }
    setDeleting(true);
    try {
      await purgeBook(chosen.id);
      setBooks(books.filter((book) => book.id !== chosen.id));
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setOpen(false);
      setDeleting(false);
    }
  };

  return (
    <>
      <Presence>
        {books.length > 0 && (
          <Reveal
            key="archived"
            as="section"
            aria-labelledby="archived"
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1">
              <h2
                id="archived"
                className="flex items-center gap-2 text-sm font-medium text-ink-faint"
              >
                <Archive aria-hidden className="size-4" />
                {t("books.archived.title")}
              </h2>
              <p className="text-sm text-ink-faint">
                {t("books.archived.intro")}
              </p>
            </div>
            <ul className="flex flex-col divide-y divide-line rounded-lg bg-surface shadow-card">
              <Presence>
                {books.map((book) => (
                  <Reveal
                    key={book.id}
                    as="li"
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <BookCover
                      book={asBook(book)}
                      className="w-9 shrink-0 opacity-60"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-ink-soft">
                        {book.title}
                      </span>
                      <span className="truncate text-xs text-ink-faint">
                        {t("books.archived.words", { count: book.words })}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("books.archived.purge", {
                        title: book.title,
                      })}
                      icon={<Trash2 aria-hidden className="size-4" />}
                      onClick={() => void ask(book)}
                    >
                      {t("books.deleting.purge")}
                    </Button>
                  </Reveal>
                ))}
              </Presence>
            </ul>
          </Reveal>
        )}
      </Presence>
      <Presence>
        {failure !== null && (
          <Reveal key="failure">
            <Notice tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          </Reveal>
        )}
      </Presence>
      <DeleteBookDialog
        book={asBook(chosen ?? NOBODY)}
        open={open && chosen !== null}
        archived
        deletion={deletion}
        deleting={deleting}
        onCancel={() => {
          setOpen(false);
        }}
        onConfirm={() => void purge()}
      />
    </>
  );
}
