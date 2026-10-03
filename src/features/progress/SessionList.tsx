import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Trash2 } from "lucide-react";
import type { SessionSummary } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/text";

interface SessionListProps {
  sessions: SessionSummary[];
  navigate: Navigate;
  /** Deletes it and loads the progress again, which no longer counts it. */
  onDelete: (sessionId: string) => Promise<void>;
}

/** The conversations, the latest first: their feedback, and a way to delete one. */
export function SessionList({
  sessions,
  navigate,
  onDelete,
}: SessionListProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const remove = async (id: string): Promise<void> => {
    setDeleting(true);
    setFailure(null);
    try {
      await onDelete(id);
      setConfirming(null);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {sessions.map((session) => {
          if (confirming === session.id) {
            return (
              <li
                key={session.id}
                className="flex flex-wrap items-center gap-2 px-2 py-4"
              >
                <p className="min-w-0 flex-1 text-ink">
                  {t("progress.deleteConfirm")}
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void remove(session.id)}
                >
                  {t("progress.deleteYes")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleting}
                  onClick={() => {
                    setConfirming(null);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </li>
            );
          }
          const summary = (
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-ink">{session.topic}</span>
              <span className="text-sm text-ink-faint">
                {[
                  formatDate(session.startedAt, i18n.language),
                  t(`mode.${session.mode}`),
                  t(`level.${session.level}`),
                  t("common.minutes", {
                    count: Math.round(session.speechMinutes),
                  }),
                ].join(" · ")}
              </span>
            </span>
          );
          return (
            <li key={session.id} className="flex items-center gap-1">
              {session.hasReport ? (
                <button
                  type="button"
                  onClick={() => {
                    navigate({
                      name: "report",
                      sessionId: session.id,
                      report: null,
                      origin: "progress",
                    });
                  }}
                  className="flex min-w-0 flex-1 items-center gap-4 px-2 py-4 text-left hover:bg-raised"
                >
                  {summary}
                  <span className="flex items-center gap-1 text-sm text-accent-text">
                    {t("progress.viewReport")}
                    <ChevronRight aria-hidden className="size-4" />
                  </span>
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-4 px-2 py-4">
                  {summary}
                  <span className="text-sm text-ink-faint">
                    {t("progress.noReport")}
                  </span>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("progress.delete", { topic: session.topic })}
                icon={<Trash2 aria-hidden className="size-4" />}
                onClick={() => {
                  setFailure(null);
                  setConfirming(session.id);
                }}
              />
            </li>
          );
        })}
      </ul>
      {failure !== null && (
        <Notice tone="danger">{t("common.error", { message: failure })}</Notice>
      )}
    </div>
  );
}
