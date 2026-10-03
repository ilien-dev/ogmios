import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatWeek, speechDuration } from "@/lib/text";

interface WeeklyBarsProps {
  weeks: Array<{ week: string; minutes: number }>;
}

function Spoken({ minutes }: { minutes: number }): ReactNode {
  const { t } = useTranslation();
  const { unit, count } = speechDuration(minutes);
  return t(`common.${unit}`, { count });
}

/**
 * Minutes of speech per week as plain CSS bars: one series, one hue, the
 * latest week labelled directly, each bar's value on hover and focus, and the
 * same numbers as a table for screen readers.
 */
export function WeeklyBars({ weeks }: WeeklyBarsProps): ReactNode {
  const { t, i18n } = useTranslation();
  const max = Math.max(1, ...weeks.map((week) => week.minutes));
  const lastIndex = weeks.length - 1;

  return (
    <figure className="flex flex-col gap-3">
      <div
        aria-hidden
        className="flex h-40 items-end gap-0.5 border-b border-line"
      >
        {weeks.map((week, i) => (
          <div
            key={week.week}
            className="group relative flex h-full flex-1 flex-col items-center justify-end"
          >
            <span
              className={
                i === lastIndex
                  ? "mb-1.5 text-xs font-medium text-ink tabular-nums"
                  : "invisible mb-1.5 rounded-sm bg-raised px-1.5 py-0.5 text-xs text-ink tabular-nums shadow-card group-hover:visible"
              }
            >
              <Spoken minutes={week.minutes} />
            </span>
            <span
              className={
                i === lastIndex
                  ? "w-full max-w-9 rounded-t-sm bg-accent"
                  : "w-full max-w-9 rounded-t-sm bg-accent/55 transition-colors duration-150 group-hover:bg-accent"
              }
              style={{ height: `${(week.minutes / max) * 80}%` }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex gap-0.5">
        {weeks.map((week, i) => (
          <span
            key={week.week}
            className="flex min-w-0 flex-1 justify-center text-xs text-ink-faint tabular-nums"
          >
            {i % 2 === lastIndex % 2 && (
              <span className="whitespace-nowrap">
                {formatWeek(week.week, i18n.language)}
              </span>
            )}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t("progress.weekly")}</caption>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.week}>
              <th scope="row">{formatWeek(week.week, i18n.language)}</th>
              <td>
                <Spoken minutes={week.minutes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
