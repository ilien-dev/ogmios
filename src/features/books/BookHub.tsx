import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, PencilLine } from "lucide-react";
import type { Book, Chapter } from "@shared/domain";
import { READY } from "@shared/domain";
import type { Navigate } from "@/app/routes";
import { Button } from "@/components/ui/Button";
import { HubCard, HubGrid } from "@/components/ui/HubCard";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { HomeLine } from "@/features/home/HomeLine";
import { errorMessage } from "@/lib/errors";
import {
  listBooks,
  listKnownWords,
  recallState,
  structuresState,
} from "@/lib/ipc";
import { chapterName } from "./chapterName";

/** The chapter the learner is on, with the book it is of. */
interface Current {
  book: Book;
  chapter: Chapter;
}

/**
 * The chapter of that id as the shelf has it now; null for none, and for
 * one whose book is no longer there.
 */
export function currentOf(
  books: readonly Book[],
  chapterId: string | null,
): Current | null {
  for (const book of books) {
    const chapter = book.chapters.find((each) => each.id === chapterId);
    if (chapter !== undefined) {
      return { book, chapter };
    }
  }
  return null;
}

interface Loaded {
  current: Current | null;
  /** Learned words the daily review asks today. */
  due: number;
  /** Words the learner said they know. */
  known: number;
}

interface BookHubProps {
  navigate: Navigate;
}

/**
 * The book section: the chapter the learner is on, the one opened last, and
 * a card for each thing done with it. The daily review is here too, though
 * its words are of every chapter.
 */
export function BookHub({ navigate }: BookHubProps): ReactNode {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      structuresState(),
      listBooks(),
      recallState(),
      listKnownWords(),
    ])
      .then(([structures, books, recall, known]) => {
        if (live) {
          setLoaded({
            current: currentOf(books, structures.chapter?.chapter.id ?? null),
            due: recall.due,
            known: known.length,
          });
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
  }, []);

  if (loaded === null) {
    return (
      <main className="grid h-full place-items-center">
        {failure === null ? (
          <Spinner />
        ) : (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </main>
    );
  }

  const { current, due, known } = loaded;
  const toShelf = (): void => {
    navigate({ name: "books", bookId: null, shelf: true });
  };
  const review = (
    <HubCard
      title={t("bookHub.recallTitle")}
      text={t("bookHub.recallText")}
      status={due > 0 ? t("home.dueWords", { count: due }) : undefined}
      due
      onClick={() => {
        navigate({ name: "recall" });
      }}
    />
  );

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-10 py-16">
        <h1 className="text-display font-semibold text-ink">{t("nav.book")}</h1>

        {current === null ? (
          <>
            <section className="flex flex-col items-start gap-4">
              <p className="text-lead text-ink-soft">{t("bookHub.empty")}</p>
              <Button variant="primary" onClick={toShelf}>
                {t("bookHub.toShelf")}
              </Button>
            </section>
            <HubGrid>{review}</HubGrid>
          </>
        ) : (
          <>
            <section
              aria-label={t("bookHub.current")}
              className="flex flex-wrap items-center gap-4 rounded-lg bg-raised px-4 py-3"
            >
              <p className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-ink">
                  {current.book.title}
                </span>
                <span className="truncate text-sm text-ink-soft">
                  {chapterName(current.chapter, t)}
                </span>
              </p>
              <Button onClick={toShelf}>{t("bookHub.change")}</Button>
            </section>
            <HubGrid>
              <HubCard
                title={t("bookHub.vocabularyTitle")}
                text={t("bookHub.vocabularyText")}
                status={
                  current.chapter.readiness === null
                    ? t("bookHub.unprepared")
                    : current.chapter.readiness === READY
                      ? t("books.ready")
                      : t("books.readiness", {
                          percent: current.chapter.readiness,
                        })
                }
                onClick={() => {
                  navigate({
                    name: "books",
                    bookId: current.book.id,
                    chapterId: current.chapter.id,
                  });
                }}
              />
              <HubCard
                title={t("bookHub.translateTitle")}
                text={t("bookHub.translateText")}
                onClick={() => {
                  navigate({
                    name: "books",
                    bookId: current.book.id,
                    chapterId: current.chapter.id,
                    translating: true,
                  });
                }}
              />
              {review}
              <HubCard
                title={t("listening.title")}
                text={t("bookHub.listeningText")}
                onClick={() => {
                  navigate({
                    name: "listening",
                    chapterId: current.chapter.id,
                  });
                }}
              />
            </HubGrid>
          </>
        )}

        <ul className="flex flex-col border-t border-line pt-4 empty:hidden">
          {current !== null && (
            <HomeLine
              icon={PencilLine}
              action={{
                label: t("bookHub.openStructures"),
                onClick: () => {
                  navigate({
                    name: "structures",
                    chapterId: current.chapter.id,
                    bookId: current.book.id,
                  });
                },
              }}
            >
              {t("bookHub.structures")}
            </HomeLine>
          )}
          {known > 0 && (
            <HomeLine
              icon={Check}
              action={{
                label: t("bookHub.openKnown"),
                onClick: () => {
                  navigate({ name: "books", bookId: null, known: true });
                },
              }}
            >
              {t("books.chapter.knownCount", { count: known })}
            </HomeLine>
          )}
        </ul>
      </div>
    </main>
  );
}
