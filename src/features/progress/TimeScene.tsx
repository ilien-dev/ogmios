import { Flame, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Progress } from "@shared/domain";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { StatChip } from "@/components/scene/Stats";
import { BarRelief } from "@/features/drills/BarRelief";
import { formatWeek } from "@/lib/text";
import { WeeklyBars } from "./WeeklyBars";

/** How many weeks the relief has room for. */
const WEEKS = 8;

interface TimeSceneProps {
  progress: Progress;
  /** Days in a row with practice; null until read. */
  streak: number | null;
  className?: string;
}

/**
 * The scene of the time spoken: the last weeks raised as columns, this one
 * lit, and along the bottom the minutes of each with its change from the week
 * before.
 */
export function TimeScene({
  progress,
  streak,
  className,
}: TimeSceneProps): ReactNode {
  const { t, i18n } = useTranslation();
  const weeks = progress.weeklyMinutes.slice(-WEEKS);
  const spoke = progress.weeklyMinutes.some((week) => week.minutes > 0);
  const sessions = progress.sessions.length;
  return (
    <Scene
      label={t("progress.time")}
      className={className}
      header={
        <>
          <SceneTitle>{t("progress.time")}</SceneTitle>
          <div className="flex flex-wrap gap-2.5">
            <Presence>
              {streak !== null && (
                <Reveal key="streak" as="span" kind="fade">
                  <StatChip>
                    <Flame aria-hidden className="size-4 text-ink" />
                    {t("progress.streak", { count: streak })}
                  </StatChip>
                </Reveal>
              )}
            </Presence>
            <StatChip value={<CountUp value={sessions} />}>
              <MessageCircle aria-hidden className="size-4 text-ink" />
              {t("progress.chipSessions", { count: sessions })}
            </StatChip>
          </div>
        </>
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
      <BarRelief
        label={t("progress.timeRelief", { count: weeks.length })}
        bars={weeks.map((week, at) => ({
          key: week.week,
          value: week.minutes,
          look: at === weeks.length - 1 ? "lit" : "plain",
          tip: {
            title: formatWeek(week.week, i18n.language),
            lines: [t("common.minutes", { count: Math.round(week.minutes) })],
          },
        }))}
        className="size-full max-w-3xl px-6 pt-32 pb-72"
      />
    </Scene>
  );
}
