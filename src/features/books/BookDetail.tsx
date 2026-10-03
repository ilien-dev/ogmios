import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { Book, Chapter } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { errorMessage } from "@/lib/errors";
import { deleteBook } from "@/lib/ipc";
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

  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 self-start"
      icon={<ArrowLeft aria-hidden className="size-4" />}
      onClick={onBack}
    >
      {t("books.all")}
    </Button>
  );

  if (book === null) {
    return (
      <main className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-8 px-10 py-16">
          {back}
          <Notice>{t("books.missing")}</Notice>
        </div>
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
      <div className="mx-auto flex max-w-2xl flex-col gap-12 px-10 py-16">
        <header className="flex flex-col gap-3">
          {back}
          <h1 className="text-display font-semibold text-ink">{book.title}</h1>
          {book.author !== null && (
            <p className="text-lead text-ink-soft">{book.author}</p>
          )}
        </header>

        <section aria-labelledby="chapters" className="flex flex-col gap-4">
          <h2 id="chapters" className="text-sm font-medium text-ink-faint">
            {t("books.chapters")}
          </h2>
          <ol className="flex flex-col divide-y divide-line border-y border-line">
            {book.chapters.map((chapter) => (
              <ChapterRow
                key={chapter.id}
                chapter={chapter}
                onOpen={onOpen}
                onRenamed={onRenamed}
              />
            ))}
          </ol>
        </section>

        <section className="flex flex-col items-start gap-4">
          {confirming ? (
            <>
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
            </>
          ) : (
            <Button
              variant="danger"
              icon={<Trash2 aria-hidden className="size-4" />}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t("books.delete")}
            </Button>
          )}
          {failure !== null && (
            <Notice tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}
        </section>
      </div>
    </main>
  );
}
