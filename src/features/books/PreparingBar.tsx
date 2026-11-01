import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChapterProgress } from "@shared/domain";
import { cn } from "@/lib/cn";

/** The parts of the chapter read so far, one piece each. */
export function PreparingBar({
  progress,
}: {
  progress: ChapterProgress;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <div
        role="progressbar"
        aria-label={t("books.chapter.preparing")}
        aria-valuemin={0}
        aria-valuenow={progress.done}
        aria-valuemax={progress.total}
        className="flex h-2 gap-1"
      >
        {Array.from({ length: progress.total }, (_, piece) => (
          <span
            key={piece}
            className={cn(
              "flex-1 rounded-full transition-colors duration-150",
              piece < progress.done ? "bg-book" : "bg-line",
            )}
          />
        ))}
      </div>
      <p className="text-sm text-ink-faint tabular-nums">
        {t("books.chapter.progress", {
          done: progress.done,
          total: progress.total,
        })}
      </p>
    </>
  );
}
