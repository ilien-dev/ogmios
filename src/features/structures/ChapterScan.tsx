import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChapterProgress } from "@shared/domain";
import type { ChapterStructures } from "@shared/structures";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/errors";
import { onStructureScan, scanChapterStructures } from "@/lib/ipc";

/** A chapter being read for its structures, and what came of it. */
export interface ChapterScan {
  /** It is being read now. */
  reading: boolean;
  /** How many of its pieces were read; null before the first report. */
  progress: ChapterProgress | null;
  found: ChapterStructures | null;
  failure: string | null;
  /** Reads it: at once when it was read before. */
  read: () => void;
}

/** Reads a chapter for its structures, hearing how far the reading is. */
export function useChapterScan(chapterId: string): ChapterScan {
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<ChapterProgress | null>(null);
  const [found, setFound] = useState<ChapterStructures | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = onStructureScan((heard) => {
      if (heard.chapterId === chapterId) {
        setProgress(heard);
      }
    });
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [chapterId]);

  const read = useCallback((): void => {
    setReading(true);
    setFailure(null);
    scanChapterStructures(chapterId)
      .then(setFound)
      .catch((error: unknown) => {
        setFailure(errorMessage(error));
      })
      .finally(() => {
        setReading(false);
      });
  }, [chapterId]);

  return { reading, progress, found, failure, read };
}

interface ScanProgressProps {
  progress: ChapterProgress | null;
}

/**
 * The chapter is being read: said in words, with a bar that fills a piece
 * at a time, so the wait is seen to be work and how much of it is left.
 */
export function ScanProgress({ progress }: ScanProgressProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex w-full flex-col gap-3">
      <p className="flex items-center gap-3 font-medium text-ink">
        <Spinner />
        {t("structures.chapter.finding")}
      </p>
      <ProgressBar
        label={t("structures.chapter.scanBar")}
        value={progress?.done ?? 0}
        total={Math.max(progress?.total ?? 1, 1)}
      />
      <p className="text-sm text-ink-soft tabular-nums">
        {progress === null
          ? t("structures.chapter.findHint")
          : t("structures.chapter.pieces", {
              done: progress.done,
              total: progress.total,
            })}
      </p>
    </div>
  );
}
