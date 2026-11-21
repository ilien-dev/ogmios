import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Progress } from "@shared/domain";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { MetricCard } from "@/components/scene/MetricCard";
import { BigNumber, StatChip } from "@/components/scene/Stats";
import { TargetChart } from "@/components/scene/TargetChart";
import { MASTERY_RATE, byLadder, meanRate } from "./ladder";
import { PatternList } from "./PatternList";

interface ProgressBoardProps {
  progress: Progress;
  selected: string | null;
  onSelect: (id: string) => void;
}

/**
 * The patterns on the column of glass: the counts, how often they go right
 * in conversation, and a card for every pattern.
 */
export function ProgressBoard({
  progress,
  selected,
  onSelect,
}: ProgressBoardProps): ReactNode {
  const { t, i18n } = useTranslation();
  const { patterns } = progress;
  const mastered = patterns.filter(
    (pattern) => pattern.state === "mastered",
  ).length;
  const mean = meanRate(patterns);
  const rated = byLadder(patterns).flatMap((pattern) =>
    pattern.correctRate === null ? [] : [pattern.correctRate * 100],
  );
  const bar = Math.round(MASTERY_RATE * 100);
  const decimal = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  return (
    <Stagger className="flex flex-col gap-3.5">
      <Reveal className="flex flex-wrap gap-2">
        <StatChip value={<CountUp value={patterns.length} />}>
          {t("progress.chipPatterns", { count: patterns.length })}
        </StatChip>
        <StatChip value={<CountUp value={mastered} />} tone="accent">
          {t("progress.tileMastered")}
        </StatChip>
        <StatChip value={<CountUp value={patterns.length - mastered} />}>
          {t("progress.tileActive")}
        </StatChip>
      </Reveal>
      <Reveal>
        <MetricCard
          title={t("progress.rightTitle")}
          number={
            <Presence>
              {mean !== null && (
                <Reveal key="mean" kind="fade">
                  <BigNumber
                    value={mean * 100}
                    unit="%"
                    size="xl"
                    format={(n) => decimal.format(n)}
                  />
                </Reveal>
              )}
            </Presence>
          }
          note={
            mean === null
              ? t("progress.rightEmpty")
              : t("progress.rightNote", { percent: bar })
          }
        >
          <Presence>
            {rated.length > 0 && (
              <Reveal key="chart" kind="fade">
                <TargetChart
                  values={rated}
                  target={bar}
                  max={100}
                  label={t("progress.rightChart", { percent: bar })}
                />
              </Reveal>
            )}
          </Presence>
        </MetricCard>
      </Reveal>
      <Reveal>
        <Presence swap>
          {patterns.length === 0 ? (
            <Reveal
              key="empty"
              as="p"
              kind="fade"
              index={0}
              className="rounded-xl glass p-5 text-sm text-ink-soft"
            >
              {t("progress.patternsEmpty")}
            </Reveal>
          ) : (
            <Reveal key="patterns" kind="fade" index={0}>
              <PatternList
                patterns={patterns}
                selected={selected}
                onSelect={onSelect}
              />
            </Reveal>
          )}
        </Presence>
      </Reveal>
    </Stagger>
  );
}
