import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Trash2 } from "lucide-react";
import type { SessionSummary } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
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

interface SessionLineProps {
  session: SessionSummary;
  navigate: Navigate;
}

/** One conversation: what it was, and its feedback if it has any. */
function SessionLine({ session, navigate }: SessionLineProps): ReactNode {
  const { t, i18n } = useTranslation();
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
  return session.hasReport ? (
    <button
      type="button"
      onClick={() => {
        navigate({
          name: "report",
          sessionId: session.id,
          report: null,
          origin: "past",
        });
      }}
      className="group flex min-w-0 flex-1 items-center gap-4 rounded-lg px-3 py-4 text-left transition-control hover:bg-sunken/60"
    >
      {summary}
      <span className="flex items-center gap-1 text-sm text-accent-text">
        {t("home.past.viewReport")}
        <ChevronRight
          aria-hidden
          className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5"
        />
      </span>
    </button>
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-4 px-3 py-4">
      {summary}
      <span className="text-sm text-ink-faint">{t("home.past.noReport")}</span>
    </div>
  );
}

/** The conversations, the latest first: their feedback, and a way to delete one. */
export function SessionList({
  sessions,
  navigate,
  onDelete,
}: SessionListProps): ReactNode {
  const { t } = useTranslation();
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
      <ul className="flex flex-col divide-y divide-line">
        <Presence>
          {sessions.map((session) => (
            <Reveal
              key={session.id}
              as="li"
              kind="fade"
              index={0}
              layout="position"
              className="relative"
            >
              <Presence swap>
                {confirming === session.id ? (
                  <Reveal
                    key="confirm"
                    kind="fade"
                    index={0}
                    className="flex flex-wrap items-center gap-2 px-3 py-4"
                  >
                    <p className="min-w-0 flex-1 text-ink">
                      {t("home.past.deleteConfirm")}
                    </p>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={deleting}
                      onClick={() => void remove(session.id)}
                    >
                      {t("home.past.deleteYes")}
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
                  </Reveal>
                ) : (
                  <Reveal
                    key="row"
                    kind="fade"
                    index={0}
                    className="flex items-center gap-1"
                  >
                    <SessionLine session={session} navigate={navigate} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="group"
                      aria-label={t("home.past.delete", {
                        topic: session.topic,
                      })}
                      icon={
                        <Trash2
                          aria-hidden
                          className="size-4 transition-transform duration-300 ease-out-expo group-hover:-rotate-12"
                        />
                      }
                      onClick={() => {
                        setFailure(null);
                        setConfirming(session.id);
                      }}
                    />
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          ))}
        </Presence>
      </ul>
      <Presence>
        {failure !== null && (
          <Notice key="failure" tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </Presence>
    </div>
  );
}
