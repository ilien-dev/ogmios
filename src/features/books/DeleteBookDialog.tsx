import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Clock, X } from "lucide-react";
import type { Book, BookDeletion } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { BookCover } from "./BookCover";

/** Off the shelf with what was practised kept, or gone with every word. */
export type DeleteWay = "archive" | "purge";

interface DeleteBookDialogProps {
  book: Book;
  open: boolean;
  /** An archived book can only be deleted for good. */
  archived?: boolean;
  /**
   * What deleting it does to its words; null until known. Kept after the
   * dialog closes, so what leaves is what was shown.
   */
  deletion: BookDeletion | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: (way: DeleteWay) => void;
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

const NONE: BookDeletion = {
  chapters: 0,
  kept: 0,
  shared: 0,
  discarded: 0,
  purged: 0,
  elsewhere: 0,
};

/** Archived: what was practised stays for the daily review. */
function ArchiveFates({ counts }: { counts: BookDeletion }): ReactNode {
  const { t } = useTranslation();
  return (
    <>
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
    </>
  );
}

/** Deleted for good: the words only this book has go with their history. */
function PurgeFates({ counts }: { counts: BookDeletion }): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <Fate
        icon={<X className="size-4" />}
        tone="bg-danger-soft text-danger"
        title={t("books.deleting.purgedTitle")}
      >
        <p className="text-sm text-ink-soft">
          {counts.purged > 0
            ? t("books.deleting.purged", { count: counts.purged })
            : t("books.deleting.purgedNone")}
        </p>
      </Fate>
      <Fate
        icon={<Check className="size-4" />}
        tone="bg-book-soft text-book"
        title={t("books.deleting.elsewhereTitle")}
      >
        <Presence>
          {counts.elsewhere > 0 && (
            <Reveal
              key="elsewhere"
              as="p"
              kind="fade"
              className="text-sm text-ink-soft"
            >
              {t("books.deleting.elsewhere", { count: counts.elsewhere })}
            </Reveal>
          )}
        </Presence>
        <p className="text-sm text-ink-soft">{t("books.deleting.known")}</p>
      </Fate>
      <p className="text-sm font-medium text-danger">
        {t("books.deleting.undone")}
      </p>
    </>
  );
}

/**
 * Asks before a book goes, and how: archived, what was practised stays for
 * the daily review and what never was goes; deleted for good, every word
 * only it has goes with its history. Each way says what happens first.
 */
export function DeleteBookDialog({
  book,
  open,
  archived = false,
  deletion,
  deleting,
  onCancel,
  onConfirm,
}: DeleteBookDialogProps): ReactNode {
  const { t } = useTranslation();
  const titleId = useId();
  const [way, setWay] = useState<DeleteWay>(archived ? "purge" : "archive");
  const counts = deletion ?? NONE;

  // Each time it opens, it starts from the gentler way.
  useEffect(() => {
    if (open) {
      setWay(archived ? "purge" : "archive");
    }
  }, [open, archived]);

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
            {archived
              ? t("books.deleting.purgeTitle", { title: book.title })
              : t("books.deleting.title", { title: book.title })}
          </h2>
          <p className="text-sm text-ink-soft">
            {t("books.deleting.lead", { count: counts.chapters })}
          </p>
        </div>
      </div>

      <Presence>
        {!archived && (
          <Reveal key="how" kind="fade">
            <ChoiceGroup<DeleteWay>
              legend={t("books.deleting.how")}
              hideLegend
              columns={2}
              size="sm"
              value={way}
              onChange={setWay}
              choices={[
                {
                  value: "archive",
                  label: t("books.deleting.archive"),
                  description: t("books.deleting.archiveHint"),
                },
                {
                  value: "purge",
                  label: t("books.deleting.purge"),
                  description: t("books.deleting.purgeHint"),
                },
              ]}
            />
          </Reveal>
        )}
      </Presence>

      <div className="relative">
        <Presence swap>
          {way === "archive" ? (
            <Reveal key="archive" kind="fade" className="flex flex-col gap-4">
              <ArchiveFates counts={counts} />
            </Reveal>
          ) : (
            <Reveal key="purge" kind="fade" className="flex flex-col gap-4">
              <PurgeFates counts={counts} />
            </Reveal>
          )}
        </Presence>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" disabled={deleting} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="danger"
          disabled={deleting}
          onClick={() => {
            onConfirm(way);
          }}
        >
          {way === "archive"
            ? t("books.deleting.archiveConfirm")
            : t("books.deleting.purgeConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}
