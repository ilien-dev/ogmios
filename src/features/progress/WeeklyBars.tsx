import { motion } from "motion/react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { WeekMinutes } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { BigNumber } from "@/components/scene/Stats";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, animated, staggerDelay } from "@/lib/motion";
import { formatWeek, speechDuration } from "@/lib/text";
import { weekAverage, weekDeltas } from "./ladder";

interface WeeklyBarsProps {
  weeks: WeekMinutes[];
}

function spoken(t: TFunction, minutes: number): string {
  const { unit, count } = speechDuration(minutes);
  return t(`common.${unit}`, { count });
}

/** The week number of an ISO week, `2026-W39` → `39`. */
function weekNumber(week: string): string {
  const at = week.indexOf("W");
  return at === -1 ? week : String(Number(week.slice(at + 1)));
}

/**
 * Minutes of speech in the last weeks, as in the proposal: this week big and
 * thin, then a row per week with its minutes, its change from the week before
 * and a bar; every week as a table for screen readers.
 */
export function WeeklyBars({ weeks }: WeeklyBarsProps): ReactNode {
  const { t, i18n } = useTranslation();
  const shown = weekDeltas(weeks);
  const max = Math.max(1, ...shown.map((week) => week.minutes));
  const lastIndex = shown.length - 1;
  const thisWeek = shown.at(-1)?.minutes ?? 0;

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <BigNumber
          value={Math.round(thisWeek)}
          unit={t("progress.weekUnit")}
          size="md"
        />
        <span className="text-sm text-ink-faint">
          {t("progress.weekThis", {
            average: spoken(t, weekAverage(weeks)),
          })}
        </span>
      </div>
      <div
        aria-hidden
        className="grid grid-cols-5 items-center gap-x-3 gap-y-2 text-sm"
      >
        <span />
        {shown.map((week) => (
          <span
            key={week.week}
            className="font-mono text-xs tracking-wider text-ink-faint uppercase"
          >
            {t("progress.weekShort", { week: weekNumber(week.week) })}
          </span>
        ))}
        {Array.from({ length: 4 - shown.length }, (_, at) => (
          <span key={`gap-${at}`} />
        ))}
        <span className="self-start justify-self-start rounded-full bg-sunken px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
          {t("progress.weekUnit")}
        </span>
        {shown.map((week, i) => (
          <span key={week.week} className="group flex items-center gap-1.5">
            <span className="font-mono text-ink tabular-nums">
              {spoken(t, week.minutes)}
            </span>
            <Presence>
              {week.delta !== null && week.delta !== 0 && (
                <Reveal
                  key="delta"
                  as="span"
                  kind="fade"
                  index={i}
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    week.delta > 0 ? "text-accent-text" : "text-ink-faint",
                  )}
                >
                  {week.delta > 0 ? `+${week.delta}` : `−${-week.delta}`}
                </Reveal>
              )}
            </Presence>
            <span className="h-1.5 min-w-4 flex-1 overflow-hidden rounded-full bg-line">
              <motion.span
                // Grown from its start with `transform`, never its width: the
                // bar has its size from the start, and only its scale arrives.
                initial={animated() ? { scaleX: 0 } : false}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: DURATION.enterSlow,
                  ease: EASE_OUT,
                  delay: 0.3 + staggerDelay(i),
                }}
                className={cn(
                  "block h-full origin-left rounded-full",
                  i === lastIndex
                    ? "bg-mint"
                    : "bg-ink-faint/60 transition-colors duration-150 group-hover:bg-ink-faint",
                )}
                style={{ width: `${(week.minutes / max) * 100}%` }}
              />
            </span>
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t("progress.weekly")}</caption>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.week}>
              <th scope="row">{formatWeek(week.week, i18n.language)}</th>
              <td>{spoken(t, week.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
