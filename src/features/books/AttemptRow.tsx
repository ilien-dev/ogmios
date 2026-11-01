import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { TranslationAttempt } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { useWay } from "./useWay";

interface AttemptRowProps {
  attempt: TranslationAttempt;
  native: string;
  /** Its place in the list, for the cascade it comes in with. */
  index: number;
  /** Goes on with it, or reads it once it is finished. */
  onOpen: () => void;
  /** Finishes a paused one without going on with it. */
  onEnd: () => void;
  /** Deletes it for good, once the learner has said so twice. */
  onDelete: () => void;
}

/** One attempt in the list: when, which way, how far, and what to do with it. */
export function AttemptRow({
  attempt,
  native,
  index,
  onOpen,
  onEnd,
  onDelete,
}: AttemptRowProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const way = useWay(attempt.direction, native);
  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(attempt.startedAt));
  return (
    <Reveal
      as="li"
      kind="fade"
      index={index}
      layout="position"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-ink">{way}</span>
        <span className="text-sm text-ink-soft">
          {[
            when,
            t("books.translate.count", {
              done: attempt.done,
              total: attempt.total,
            }),
            attempt.finished
              ? t("books.translate.finishedTag")
              : t("books.translate.paused"),
          ].join(" · ")}
        </span>
      </span>
      <div className="relative">
        <Presence swap>
          {confirming ? (
            <Reveal
              key="confirm"
              kind="fade"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm text-ink">
                {t("books.translate.deleteConfirm")}
              </span>
              <Button size="sm" variant="danger" onClick={onDelete}>
                {t("books.deleteYes")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t("common.cancel")}
              </Button>
            </Reveal>
          ) : (
            <Reveal
              key="actions"
              kind="fade"
              className="flex flex-wrap items-center gap-2"
            >
              <Presence swap>
                {attempt.finished ? (
                  <Reveal key="finished" as="span" kind="fade">
                    <Button size="sm" onClick={onOpen}>
                      {t("books.translate.view")}
                    </Button>
                  </Reveal>
                ) : (
                  <Reveal key="no-finished">
                    <Button size="sm" variant="primaryBook" onClick={onOpen}>
                      {t("books.translate.continue")}
                    </Button>
                    <Button size="sm" onClick={onEnd}>
                      {t("books.translate.end")}
                    </Button>
                  </Reveal>
                )}
              </Presence>
              <button
                type="button"
                aria-label={t("books.translate.delete")}
                title={t("books.translate.delete")}
                onClick={() => {
                  setConfirming(true);
                }}
                className="grid size-8 place-items-center rounded-full text-ink-faint transition-control hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </Reveal>
          )}
        </Presence>
      </div>
    </Reveal>
  );
}
