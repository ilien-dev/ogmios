import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { Book, Chapter } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Tilt } from "@/components/motion/Tilt";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { errorMessage } from "@/lib/errors";
import { deleteBook } from "@/lib/ipc";
import { BookCover } from "./BookCover";
import { ChapterRow } from "./ChapterRow";

interface BookDetailProps {
  /** Null when the book was deleted while it was open. */
  book: Book | null;
  onBack: () => void;
  onDeleted: () => void;
  onOpen: (chapter: Chapter) => void;
  onRenamed: (chapter: Chapter) => void;
}

/** One book: its chapters in reading order, and the way to delete it. */
export function BookDetail({
  book,
  onBack,
  onDeleted,
  onOpen,
  onRenamed,
}: BookDetailProps): ReactNode {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const back = <BackLink label={t("books.all")} onClick={onBack} />;

  if (book === null) {
    return (
      <main className="h-full overflow-y-auto">
        <Stagger className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 nav:py-16">
          <Reveal>{back}</Reveal>
          <Reveal>
            <Notice>{t("books.missing")}</Notice>
          </Reveal>
        </Stagger>
      </main>
    );
  }

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setFailure(null);
    try {
      await deleteBook(book.id);
      onDeleted();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="h-full overflow-y-auto">
      <Stagger className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-12 nav:py-16">
        <Reveal as="header" className="flex flex-col gap-4">
          {back}
          <div className="flex items-center gap-6">
            <Tilt className="shrink-0">
              <BookCover book={book} className="w-24" />
            </Tilt>
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="font-display text-title font-light text-ink">
                {book.title}
              </h1>
              <Presence>
                {book.author !== null && (
                  <Reveal
                    key="author"
                    as="p"
                    className="text-lead text-ink-soft"
                  >
                    {book.author}
                  </Reveal>
                )}
              </Presence>
            </div>
          </div>
        </Reveal>

        <Reveal
          as="section"
          aria-labelledby="chapters"
          className="flex flex-col gap-4"
        >
          <h2 id="chapters" className="text-sm font-medium text-ink-faint">
            {t("books.chapters")}
          </h2>
          <Stagger
            as="ol"
            className="flex flex-col divide-y divide-line rounded-xl bg-surface py-2 shadow-card"
          >
            {book.chapters.map((chapter) => (
              <ChapterRow
                key={chapter.id}
                chapter={chapter}
                onOpen={onOpen}
                onRenamed={onRenamed}
              />
            ))}
          </Stagger>
        </Reveal>

        <Reveal
          as="section"
          className="relative flex flex-col items-start gap-4"
        >
          <Presence swap>
            {confirming ? (
              <Reveal key="confirm" kind="fade" className="flex flex-col gap-4">
                <p className="text-ink">{t("books.deleteConfirm")}</p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    disabled={deleting}
                    onClick={() => void remove()}
                  >
                    {t("books.deleteYes")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={deleting}
                    onClick={() => {
                      setConfirming(false);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </Reveal>
            ) : (
              <Reveal key="delete" kind="fade">
                <Button
                  variant="danger"
                  icon={<Trash2 aria-hidden className="size-4" />}
                  onClick={() => {
                    setConfirming(true);
                  }}
                >
                  {t("books.delete")}
                </Button>
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
        </Reveal>
      </Stagger>
    </main>
  );
}
