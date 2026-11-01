import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import type { ListeningState, PaceStanding } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { ProgressBar } from "@/components/ui/ProgressBar";

/** The pace the learner understands, and how each one stands under it. */
export function Standing({ state }: { state: ListeningState }): ReactNode {
  const { t } = useTranslation();
  const row = (standing: PaceStanding, index: number): ReactNode => {
    const name = t(`listening.pace.${standing.pace}`);
    return (
      <Reveal
        as="li"
        key={standing.pace}
        index={index}
        className="flex items-center gap-4 px-5 py-3"
      >
        <span className="flex w-28 shrink-0 items-center gap-2 font-medium text-ink">
          {name}
          <Presence>
            {standing.held && (
              <Reveal key="held" as="span" kind="fade">
                <CircleCheck
                  role="img"
                  aria-label={t("listening.standing.held")}
                  className="size-4 text-accent-text"
                />
              </Reveal>
            )}
          </Presence>
        </span>
        <span className="min-w-0 flex-1">
          <ProgressBar
            label={t("listening.standing.bar", { pace: name })}
            value={standing.sentences === 0 ? 0 : standing.right}
            total={standing.sentences === 0 ? 1 : standing.total}
            tone="book"
          />
        </span>
        <span className="w-40 shrink-0 text-right text-sm text-ink-faint tabular-nums">
          {standing.sentences === 0
            ? t("listening.standing.none")
            : t("listening.standing.count", {
                count: standing.sentences,
                percent: Math.floor((standing.right * 100) / standing.total),
              })}
        </span>
      </Reveal>
    );
  };
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-faint">
          {t("listening.understood.label")}
        </p>
        <Presence swap>
          {state.understood === null ? (
            <Reveal key="none" className="flex flex-col gap-1">
              <p className="font-display text-title font-normal text-ink-soft">
                {t("listening.understood.none")}
              </p>
              <p className="text-sm text-ink-soft">
                {t("listening.understood.noneHint")}
              </p>
            </Reveal>
          ) : (
            <Reveal
              key="understood"
              as="p"
              className="font-display text-display font-light text-accent-text"
            >
              {t(`listening.pace.${state.understood}`)}
            </Reveal>
          )}
        </Presence>
      </div>
      <ul
        aria-label={t("listening.standing.title")}
        className="flex flex-col divide-y divide-line rounded-xl bg-surface py-1 shadow-card"
      >
        {[...state.standings].reverse().map(row)}
      </ul>
      <p className="text-sm text-ink-faint">{t("listening.standing.note")}</p>
    </section>
  );
}
