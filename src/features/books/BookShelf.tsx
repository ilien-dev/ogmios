import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plus } from "lucide-react";
import type { Book } from "@shared/domain";
import { READY } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Tilt } from "@/components/motion/Tilt";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Orb } from "@/components/ui/Orb";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { BookCover } from "./BookCover";

interface BookCardProps {
  book: Book;
  index: number;
  navigate: Navigate;
}

/** One book of the shelf: its cover, what it holds and how much is ready. */
function BookCard({ book, index, navigate }: BookCardProps): ReactNode {
  const { t } = useTranslation();
  const ready = book.chapters.filter((each) => each.readiness === READY).length;
  return (
    <Reveal as="li" index={index}>
      <Tilt>
        <button
          type="button"
          onClick={() => {
            navigate({ name: "books", bookId: book.id });
          }}
          className="group flex w-full items-center gap-5 rounded-lg bg-surface p-4 text-left shadow-card transition-control"
        >
          <BookCover book={book} className="w-15" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate font-medium text-ink">{book.title}</span>
            <span className="truncate text-sm text-ink-faint">
              {[
                book.author,
                t("books.chapterCount", { count: book.chapters.length }),
                ready > 0 ? t("books.readyCount", { count: ready }) : null,
              ]
                .filter((part) => part !== null)
                .join(" · ")}
            </span>
            <span className="mt-1.5 block max-w-64">
              <ProgressBar
                label={t("books.readyCount", { count: ready })}
                value={ready}
                total={book.chapters.length}
                tone="book"
              />
            </span>
          </span>
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
          />
        </button>
      </Tilt>
    </Reveal>
  );
}

interface BookShelfProps {
  books: Book[];
  adding: boolean;
  /** Why the last book was not taken, in words. */
  refusal: string | null;
  /** How many words the learner marked as known, across every book. */
  knownCount: number;
  onAdd: () => void;
  navigate: Navigate;
}

/** The shelf of uploaded books, with the way to add one. */
export function BookShelf({
  books,
  adding,
  refusal,
  knownCount,
  onAdd,
  navigate,
}: BookShelfProps): ReactNode {
  const { t } = useTranslation();
  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-12 nav:py-16">
        <Reveal index={0} className="flex items-center gap-6">
          <Orb size="md" section="book" />
          <header className="flex min-w-0 flex-col gap-2">
            <h1 className="font-display text-display font-light text-ink">
              {t("books.title")}
            </h1>
            <p className="text-lead text-ink-soft">{t("books.intro")}</p>
          </header>
        </Reveal>

        <Reveal index={1} className="flex flex-col items-start gap-4">
          <Button
            variant="primaryBook"
            size="lg"
            disabled={adding}
            icon={
              adding ? (
                <Spinner className="size-5" />
              ) : (
                <Plus aria-hidden className="size-5" />
              )
            }
            onClick={onAdd}
          >
            {adding ? t("books.adding") : t("books.add")}
          </Button>
          <p className="text-sm text-ink-faint">{t("books.privacy")}</p>
          <Presence>
            {refusal !== null && (
              <Reveal key="refusal">
                <Notice tone="danger">{refusal}</Notice>
              </Reveal>
            )}
          </Presence>
        </Reveal>

        {books.length === 0 ? (
          <Reveal as="p" index={2} className="text-ink-soft">
            {t("books.empty")}
          </Reveal>
        ) : (
          <ul className="flex flex-col gap-3">
            <Presence>
              {books.map((book, index) => (
                <BookCard
                  key={book.id}
                  book={book}
                  index={index + 2}
                  navigate={navigate}
                />
              ))}
            </Presence>
          </ul>
        )}

        <Presence>
          {knownCount > 0 && (
            <Reveal key="known" kind="fade" className="self-start">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 text-ink-faint"
                onClick={() => {
                  navigate({ name: "books", bookId: null, known: true });
                }}
              >
                {t("books.chapter.knownCount", { count: knownCount })}
              </Button>
            </Reveal>
          )}
        </Presence>
      </div>
    </main>
  );
}
