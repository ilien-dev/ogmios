import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { SessionMetrics } from "@shared/domain";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/text";
import type { Step } from "../steps";
import { CardTitle } from "./CardTitle";

type MetricsStep = Extract<Step, { kind: "metrics" }>;

type MetricKey =
  | "speechMinutes"
  | "userWords"
  | "wordsPerTurn"
  | "userShare"
  | "mtld"
  | "errorsPer100";

/** Whether a rise is good news. Slips are the one metric where less is more. */
const ROWS: Array<{ key: MetricKey; higherIsBetter: boolean; digits: number }> =
  [
    { key: "speechMinutes", higherIsBetter: true, digits: 1 },
    { key: "userWords", higherIsBetter: true, digits: 0 },
    { key: "wordsPerTurn", higherIsBetter: true, digits: 0 },
    { key: "userShare", higherIsBetter: true, digits: 0 },
    { key: "mtld", higherIsBetter: true, digits: 0 },
    { key: "errorsPer100", higherIsBetter: false, digits: 1 },
  ];

function value(metrics: SessionMetrics, key: MetricKey): number | null {
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
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <CardTitle>{t("report.metrics.title")}</CardTitle>
        <p className="text-ink-soft">
          {card.previous === null
            ? t("report.metrics.baseline", { modality })
            : t("report.metrics.against", { modality })}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-10 gap-y-8">
        {ROWS.map(({ key, higherIsBetter, digits }) => {
          const now = value(card.current, key);
          if (now === null) {
            return null;
          }
          const before =
            card.previous === null ? null : value(card.previous, key);
          const delta = before === null ? 0 : now - before;
          const flat = before === null || Math.abs(delta) < 10 ** -digits / 2;
          const better = flat ? null : delta > 0 === higherIsBetter;
          const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <dt className="text-sm text-ink-soft">
                {t(`report.metrics.${key}`)}
              </dt>
              <dd className="text-title font-semibold text-ink tabular-nums">
                {show(key, now, digits)}
              </dd>
              {before !== null && (
                <dd
                  className={cn(
                    "flex items-center gap-1 text-sm",
                    better === null
                      ? "text-ink-faint"
                      : better
                        ? "text-correct"
                        : "text-partial",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {flat
                    ? t("report.metrics.same")
                    : t(
                        delta > 0 ? "report.metrics.up" : "report.metrics.down",
                        {
                          previous: show(key, before, digits),
                        },
                      )}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </div>
  );
}
