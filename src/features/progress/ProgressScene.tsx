import { CalendarClock, ChartNoAxesColumnIncreasing } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PatternView, Progress } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { BigNumber, StatChip } from "@/components/scene/Stats";
import { formatDate } from "@/lib/text";
import { stepsLeft } from "./ladder";
import { Staircase } from "./Staircase";
import { WeeklyBars } from "./WeeklyBars";

/** The glass card over the staircase: the pattern picked, or the focus. */
function PatternTip({ pattern }: { pattern: PatternView | null }): ReactNode {
  const { t } = useTranslation();
  if (pattern === null) {
    return (
      <span className="text-sm text-ink-faint">{t("progress.focusNone")}</span>
    );
  }
  const left = stepsLeft(pattern.state);
  return (
    <>
      <span className="text-base font-semibold text-ink">
        {pattern.description}
      </span>
      <span className="text-sm text-ink-faint">
        {[
          t(`patternState.${pattern.state}`),
          left === 0 ? null : t("progress.stepsLeft", { count: left }),
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      </span>
      <Presence>
        {pattern.correctRate !== null && (
          <Reveal key="rate" as="span" kind="fade">
            <BigNumber
              value={Math.round(pattern.correctRate * 100)}
              unit="%"
              size="md"
              className="text-accent-text"
            />
          </Reveal>
        )}
      </Presence>
      <span className="text-sm text-ink-faint">
        {[
          pattern.correctRate === null
            ? t("progress.rateNone")
            : t("progress.rightShort"),
          t("progress.seen", { count: pattern.sessionsSeen }),
        ].join(" · ")}
      </span>
    </>
  );
}

interface ProgressSceneProps {
  progress: Progress;
  /** The pattern the card over the staircase shows. */
  shown: PatternView | null;
  className?: string;
}

/**
 * The scene of Progress: the patterns as a staircase from noticed to
 * mastered, the pattern picked in a glass card over it, and the time spoken
 * week by week along the bottom.
 */
export function ProgressScene({
  progress,
  shown,
  className,
}: ProgressSceneProps): ReactNode {
  const { t, i18n } = useTranslation();
  const next = progress.patterns
    .map((pattern) => pattern.nextReviewAt)
    .filter((date) => date !== null)
    .sort()
    .at(0);
  const spoke = progress.weeklyMinutes.some((week) => week.minutes > 0);

  return (
    <Scene
      label={t("progress.patterns")}
      zoom
      className={className}
      header={
        <>
          <SceneTitle>{t("progress.patterns")}</SceneTitle>
          <div className="flex flex-wrap gap-2.5">
            <StatChip>
              <ChartNoAxesColumnIncreasing
                aria-hidden
                className="size-4 text-ink"
              />
              {`${t("patternState.detected")} → ${t("patternState.mastered")}`}
            </StatChip>
            <Presence>
              {next !== undefined && (
                <Reveal key="next" as="span" kind="fade">
                  <StatChip>
                    <CalendarClock aria-hidden className="size-4 text-ink" />
                    {t("progress.nextReview", {
                      date: formatDate(next, i18n.language),
                    })}
                  </StatChip>
                </Reveal>
              )}
            </Presence>
          </div>
        </>
      }
      overlay={
        <Reveal
          kind="scale"
          index={4}
          className="absolute top-1/4 left-1/2 z-10 flex w-64 flex-col gap-1.5 rounded-xl glass-float px-4.5 py-4"
        >
          <Presence swap>
            <Reveal
              key={shown?.id ?? "none"}
              kind="fade"
              index={0}
              className="flex flex-col gap-1.5"
            >
              <PatternTip pattern={shown} />
            </Reveal>
          </Presence>
        </Reveal>
      }
      footer={
        <Reveal
          index={6}
          className="flex flex-col gap-3 rounded-xl glass px-5.5 py-4.5"
        >
          <span className="font-display text-base tracking-tight text-ink">
            {t("progress.weekly")}
          </span>
          <Presence swap>
            {spoke ? (
              <Reveal key="weeks" kind="fade" index={0}>
                <WeeklyBars weeks={progress.weeklyMinutes} />
              </Reveal>
            ) : (
              <Reveal
                key="empty"
                as="span"
                kind="fade"
                index={0}
                className="text-sm text-ink-faint"
              >
                {t("progress.weeklyEmpty")}
              </Reveal>
            )}
          </Presence>
        </Reveal>
      }
    >
      <Staircase
        patterns={progress.patterns}
        selected={shown?.id ?? null}
        className="size-full max-w-4xl px-6 pt-32 pb-72"
      />
    </Scene>
  );
}
