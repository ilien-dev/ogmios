import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { SessionMetrics } from "@shared/domain";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/text";
import type { Step } from "../steps";
import { trend } from "../trend";

type MetricsStep = Extract<Step, { kind: "metrics" }>;

export type MetricKey =
  | "speechMinutes"
  | "userWords"
  | "wordsPerTurn"
  | "userShare"
  | "mtld"
  | "errorsPer100";

/** Whether a rise is good news. Slips are the one metric where less is more. */
export const ROWS: Array<{
  key: MetricKey;
  higherIsBetter: boolean;
  digits: number;
}> = [
  { key: "speechMinutes", higherIsBetter: true, digits: 1 },
  { key: "userWords", higherIsBetter: true, digits: 0 },
  { key: "wordsPerTurn", higherIsBetter: true, digits: 0 },
  { key: "userShare", higherIsBetter: true, digits: 0 },
  { key: "mtld", higherIsBetter: true, digits: 0 },
  { key: "errorsPer100", higherIsBetter: false, digits: 1 },
];

export function metricValue(
  metrics: SessionMetrics,
  key: MetricKey,
): number | null {
  const raw = metrics[key];
  if (raw === null) {
    return null;
  }
  return key === "userShare" ? raw * 100 : raw;
}

/** §7.7: trends against earlier sessions of the same kind. Never a score. */
export function MetricsCard({
  card,
}: {
  card: MetricsStep["card"];
}): ReactNode {
  const { t, i18n } = useTranslation();
  const modality = t(`modality.${card.current.modality}`);
  const show = (key: MetricKey, raw: number, digits: number): string => {
    const text = formatNumber(raw, i18n.language, digits);
    return key === "userShare"
      ? t("report.metrics.percent", { value: text })
      : text;
  };

  return (
    <div className="flex flex-col gap-6">
      <Reveal as="p" className="text-ink-soft">
        {card.previous === null
          ? t("report.metrics.baseline", { modality })
          : t("report.metrics.against", { modality })}
      </Reveal>
      <Stagger as="dl" className="grid grid-cols-2 gap-3 nav:grid-cols-3">
        {ROWS.map(({ key, higherIsBetter, digits }) => {
          const now = metricValue(card.current, key);
          if (now === null) {
            return null;
          }
          const before =
            card.previous === null ? null : metricValue(card.previous, key);
          const { delta, flat, better } = trend(
            now,
            before,
            digits,
            higherIsBetter,
          );
          const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
          return (
            <Reveal
              key={key}
              className="flex flex-col gap-1.5 rounded-xl border border-line bg-sunken/70 px-4 py-3.5"
            >
              <dt className="text-sm text-ink-faint">
                {t(`report.metrics.${key}`)}
              </dt>
              <dd className="font-display text-4xl leading-none font-light tracking-tight text-ink tabular-nums">
                <CountUp
                  value={now}
                  from={0}
                  format={(n) => show(key, n, digits)}
                />
              </dd>
              <Presence>
                {before !== null && (
                  <Reveal
                    key="before"
                    as="dd"
                    className={cn(
                      "flex items-center gap-1 font-mono text-xs",
                      better === null
                        ? "text-ink-faint"
                        : better
                          ? "text-accent-text"
                          : "text-partial",
                    )}
                  >
                    <Icon aria-hidden className="size-3.5" />
                    {flat
                      ? t("report.metrics.same")
                      : t(
                          delta > 0
                            ? "report.metrics.up"
                            : "report.metrics.down",
                          {
                            previous: show(key, before, digits),
                          },
                        )}
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          );
        })}
      </Stagger>
    </div>
  );
}
