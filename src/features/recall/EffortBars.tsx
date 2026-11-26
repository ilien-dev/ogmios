import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { WordEffort } from "@shared/recall";
import { cn } from "@/lib/cn";

/** Bars filled for each effort: the harder, the more. */
const FILLED: Record<WordEffort, number> = { easy: 1, mid: 2, hard: 3 };

/** The bars from lowest to tallest, at each size. */
const BARS = {
  md: ["h-2", "h-2.75", "h-3.5"],
  sm: ["h-1.5", "h-2.25", "h-3"],
} as const;

interface EffortBarsProps {
  effort: WordEffort;
  size?: keyof typeof BARS;
  className?: string;
}

/**
 * How much the words of an effort cost, as three rising bars like a
 * signal's: one filled for the easy ones, all three for the hard ones.
 */
export function EffortBars({
  effort,
  size = "md",
  className,
}: EffortBarsProps): ReactNode {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t(`recall.effort.${effort}.bars`)}
      className={cn("inline-flex shrink-0 items-end gap-0.5", className)}
    >
      {BARS[size].map((height, index) => (
        <span
          key={height}
          className={cn(
            "rounded-xs",
            size === "md" ? "w-1" : "w-0.75",
            height,
            index < FILLED[effort] ? "bg-tally" : "bg-line-strong",
          )}
        />
      ))}
    </span>
  );
}
