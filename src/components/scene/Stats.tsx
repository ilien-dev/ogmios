import type { ReactNode } from "react";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";

interface StatChipProps {
  value?: ReactNode;
  children: ReactNode;
  tone?: keyof typeof TONES;
}

const TONES = {
  ink: "text-ink",
  accent: "text-accent-text",
  book: "text-book",
};

/** A glass chip with a number in mono, as on top of the proposal columns. */
export function StatChip({
  value,
  children,
  tone = "ink",
}: StatChipProps): ReactNode {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-full glass px-4 text-sm text-ink-soft">
      <Presence>
        {value !== undefined && (
          <Reveal
            key="value"
            as="span"
            kind="fade"
            className={cn("font-mono font-medium", TONES[tone])}
          >
            {value}
          </Reveal>
        )}
      </Presence>
      {children}
    </span>
  );
}

const SIZES = { md: "text-5xl", lg: "text-6xl", xl: "text-7xl" };

interface BigNumberProps {
  value: number;
  unit?: ReactNode;
  format?: (n: number) => string;
  size?: keyof typeof SIZES;
  className?: string;
}

/** A big, thin number with its unit, counting up as it arrives. */
export function BigNumber({
  value,
  unit,
  format,
  size = "lg",
  className,
}: BigNumberProps): ReactNode {
  return (
    <span className={cn("flex items-baseline gap-1.5", className)}>
      <CountUp
        value={value}
        from={0}
        format={format}
        className={cn(
          "font-display leading-none font-light tracking-tight tabular-nums",
          SIZES[size],
        )}
      />
      <Presence>
        {unit !== undefined && (
          <Reveal
            key="unit"
            as="span"
            kind="fade"
            className="font-display text-2xl font-light text-ink-faint"
          >
            {unit}
          </Reveal>
        )}
      </Presence>
    </span>
  );
}

interface StatTileProps {
  icon: ReactNode;
  label: string;
  value: number;
}

/** A glass tile: an icon at the top, a label and a big thin number below. */
export function StatTile({ icon, label, value }: StatTileProps): ReactNode {
  return (
    <div className="flex flex-col gap-5 rounded-xl glass px-5 pt-4.5 pb-4">
      <span className="flex size-6 items-center justify-center">{icon}</span>
      <span className="flex items-end justify-between gap-2">
        <span className="text-sm text-ink-soft">{label}</span>
        <BigNumber value={value} size="md" />
      </span>
    </div>
  );
}
