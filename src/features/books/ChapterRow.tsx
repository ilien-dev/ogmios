import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import type { Chapter } from "@shared/domain";
import { READY } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextInput } from "@/components/ui/TextInput";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { renameChapter } from "@/lib/ipc";
import { chapterName, chapterPlaceName } from "./chapterName";

interface ChapterRowProps {
  chapter: Chapter;
  onOpen: (chapter: Chapter) => void;
  onRenamed: (chapter: Chapter) => void;
}

/**
 * One chapter of a book. A part the book does not name is called by its place
 * (a PDF without bookmarks is all such parts); the learner can name any of them.
 * Its name opens it. Once prepared it says how ready it is to be read.
 */
export function ChapterRow({
  chapter,
  onOpen,
  onRenamed,
}: ChapterRowProps): ReactNode {
  const { t } = useTranslation();
  /** The name being typed; null while the row is only shown. */
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const placeName = chapterPlaceName(chapter, t);
  const name = chapterName(chapter, t);

  const save = async (title: string): Promise<void> => {
    setSaving(true);
    setFailure(null);
    try {
      onRenamed(await renameChapter(chapter.id, title));
      setDraft(null);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 px-2 py-3">
      <div className="flex items-baseline gap-4">
        <span className="w-6 shrink-0 text-right text-sm text-ink-faint tabular-nums">
          {chapter.index + 1}
        </span>
        {draft === null ? (
          <>
            <button
              type="button"
              onClick={() => {
                onOpen(chapter);
              }}
              className="min-w-0 flex-1 truncate text-left text-ink hover:underline"
            >
              {name}
            </button>
            {chapter.readiness !== null && (
              <span
                className={cn(
                  "shrink-0 text-sm tabular-nums",
                  chapter.readiness === READY
                    ? "font-medium text-accent-text"
                    : "text-ink-soft",
                )}
              >
                {chapter.readiness === READY
                  ? t("books.ready")
                  : t("books.readiness", { percent: chapter.readiness })}
              </span>
            )}
            <span className="shrink-0 text-sm text-ink-faint tabular-nums">
              {t("books.wordCount", { count: chapter.words })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="self-center px-2"
              aria-label={t("books.rename", { name })}
              icon={<Pencil aria-hidden className="size-4" />}
              onClick={() => {
                setDraft(chapter.title);
              }}
            />
          </>
        ) : (
          <form
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save(draft);
            }}
          >
            <TextInput
              autoFocus
              className="min-w-0 flex-1"
              aria-label={t("books.renameLabel")}
              placeholder={placeName}
              value={draft}
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft(null);
                }
              }}
            />
            <Button type="submit" variant="primary" disabled={saving}>
              {t("common.save")}
            </Button>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setDraft(null);
                setFailure(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </form>
        )}
      </div>
      {failure !== null && (
        <Notice tone="danger">{t("common.error", { message: failure })}</Notice>
      )}
    </li>
  );
}
