import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateDownload } from "@shared/domain";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatBytes } from "@/lib/text";

const FULL = 100;

/**
 * How far the release's download is: a bar, the share and the size. A server
 * that does not say how much there is gets a bar that only shows it is busy.
 */
export function UpdateProgress({
  progress,
}: {
  progress: UpdateDownload | null;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const received = progress?.received ?? 0;
  const total = progress?.total ?? null;

  if (total === null || total === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label={t("update.progress")}
          className="h-1 w-full animate-pulse-soft rounded-full bg-accent"
        />
        {progress !== null && (
          <p className="text-sm text-ink-soft">
            {formatBytes(received, i18n.language)}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ProgressBar
        label={t("update.progress")}
        value={received}
        total={total}
      />
      <p className="flex justify-between gap-3 text-sm text-ink-soft">
        <span>
          {t("update.percent", {
            percent: Math.floor((Math.min(received, total) / total) * FULL),
          })}
        </span>
        <span>
          {t("update.size", {
            received: formatBytes(received, i18n.language),
            total: formatBytes(total, i18n.language),
          })}
        </span>
      </p>
    </div>
  );
}
