import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ListeningChapter, Pace } from "@shared/listening";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { PaceChoice } from "./PaceChoice";

interface OnChapterProps {
  on: ListeningChapter;
  pace: Pace;
  busy: boolean;
  onPace: (pace: Pace) => void;
  onDictation: () => void;
  onListen: () => void;
}

/**
 * The two things to do with the chapter the learner is on, as two cards:
 * side by side when the tab is wide, one under the other when not.
 */
export function OnChapter({
  on,
  pace,
  busy,
  onPace,
  onDictation,
  onListen,
}: OnChapterProps): ReactNode {
  const { t } = useTranslation();
  const left = on.place > 0;
  return (
    <ul className="grid gap-3 @2xl:grid-cols-2">
      <li className="flex flex-col gap-4 rounded-xl glass px-5 py-4.5">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-display font-medium tracking-tight text-ink">
            {t("listening.listen.title")}
          </span>
          <span className="text-sm text-ink-soft tabular-nums">
            {left
              ? t("listening.listen.place", {
                  current: on.place + 1,
                  total: on.sentences,
                })
              : t("listening.listen.fresh", { count: on.sentences })}
          </span>
        </span>
        <ProgressBar
          label={t("listening.reading.progress")}
          value={on.place}
          total={Math.max(on.sentences, 1)}
          tone="book"
        />
        <Button variant="primaryBook" className="self-start" onClick={onListen}>
          {left ? t("listening.listen.continue") : t("listening.listen.start")}
        </Button>
      </li>
      <li className="flex flex-col gap-4 rounded-xl glass px-5 py-4.5">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-display font-medium tracking-tight text-ink">
            {t("listening.dictation.title")}
          </span>
          <span className="text-sm text-ink-soft">
            {t("listening.dictation.hint")}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-3">
          <PaceChoice value={pace} onChange={onPace} />
          <Button disabled={busy} onClick={onDictation}>
            {t("listening.dictation.start")}
          </Button>
        </span>
      </li>
    </ul>
  );
}
