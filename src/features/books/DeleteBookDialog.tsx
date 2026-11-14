import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Check, Clock, X } from "lucide-react";
import type { Book, BookDeletion } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { BookCover } from "./BookCover";

interface DeleteBookDialogProps {
  book: Book;
  open: boolean;
  /**
   * What deleting it does to its words; null until known. Kept after the
   * dialog closes, so what leaves is what was shown.
   */
  deletion: BookDeletion | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

interface FateProps {
  icon: ReactNode;
  tone: string;
  title: string;
  children: ReactNode;
}

/** One thing that happens to the book's words, under its own mark. */
function Fate({ icon, tone, title, children }: FateProps): ReactNode {
  return (
    <div className="flex items-start gap-4 rounded-lg bg-sunken p-4">
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          tone,
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * Asks before a book goes, saying what happens to its words: what was
 * practised stays for the daily review, what never was goes.
 */
export function DeleteBookDialog({
  book,
  open,
  deletion,
  deleting,
  onCancel,
  onConfirm,
}: DeleteBookDialogProps): ReactNode {
  const { t } = useTranslation();
  const titleId = useId();
  const counts = deletion ?? { chapters: 0, kept: 0, shared: 0, discarded: 0 };

  return (
    <Dialog
      open={open && deletion !== null}
      labelledBy={titleId}
      onClose={onCancel}
    >
      <div className="flex items-center gap-4">
        <BookCover book={book} className="w-12 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-lead font-medium text-ink">
            {t("books.deleting.title", { title: book.title })}
          </h2>
          <p className="text-sm text-ink-soft">
            {t("books.deleting.lead", { count: counts.chapters })}
          </p>
        </div>
      </div>

      <Fate
        icon={<Check className="size-4" />}
        tone="bg-book-soft text-book"
        title={t("books.deleting.keptTitle")}
      >
        <p className="text-sm text-ink-soft">
          {counts.kept > 0
            ? t("books.deleting.kept", { count: counts.kept })
            : t("books.deleting.keptNone")}
        </p>
        <Presence>
          {counts.shared > 0 && (
            <Reveal
              key="shared"
              as="p"
              kind="fade"
              className="text-xs text-ink-faint"
            >
              {t("books.deleting.shared", { count: counts.shared })}
            </Reveal>
          )}
        </Presence>
      </Fate>

      <Presence>
        {counts.discarded > 0 && (
          <Reveal key="discarded" kind="fade">
            <Fate
              icon={<X className="size-4" />}
              tone="bg-danger-soft text-danger"
              title={t("books.deleting.discardedTitle")}
            >
              <p className="text-sm text-ink-soft">
                {t("books.deleting.discarded", { count: counts.discarded })}
              </p>
            </Fate>
          </Reveal>
        )}
      </Presence>

      <Fate
        icon={<Clock className="size-4" />}
        tone="bg-tally-soft text-tally"
        title={t("books.deleting.chaptersTitle")}
      >
        <p className="text-sm text-ink-soft">{t("books.deleting.chapters")}</p>
      </Fate>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" disabled={deleting} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="danger" disabled={deleting} onClick={onConfirm}>
          {t("books.delete")}
        </Button>
      </div>
    </Dialog>
  );
}
