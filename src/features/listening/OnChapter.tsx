import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ListeningChapter, Pace } from "@shared/listening";
import { Button } from "@/components/ui/Button";
import { PaceChoice } from "./PaceChoice";

interface OnChapterProps {
  on: ListeningChapter;
  pace: Pace;
  busy: boolean;
  onPace: (pace: Pace) => void;
  onDictation: () => void;
  onListen: () => void;
}

/** The two things to do with the chapter the learner is on. */
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
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface/60 py-1">
      <li className="flex flex-wrap items-center gap-4 px-5 py-4">
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
        <Button variant="primaryBook" onClick={onListen}>
          {left ? t("listening.listen.continue") : t("listening.listen.start")}
        </Button>
      </li>
      <li className="flex flex-wrap items-center gap-4 px-5 py-4">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-display font-medium tracking-tight text-ink">
            {t("listening.dictation.title")}
          </span>
          <span className="text-sm text-ink-soft">
            {t("listening.dictation.hint")}
          </span>
        </span>
        <PaceChoice value={pace} onChange={onPace} />
        <Button disabled={busy} onClick={onDictation}>
          {t("listening.dictation.start")}
        </Button>
      </li>
    </ul>
  );
}
