import type { ReactNode } from "react";

const FULL = 100;

interface ProgressBarProps {
  /** What the bar measures, for a screen reader: it shows no text. */
  label: string;
  /** How far, out of `total`. Nothing to count is as far as it goes. */
  value: number;
  total: number;
}

/**
 * A thin bar that says how far something is, and goes back as well as on.
 * It is announced as a whole percentage, rounded down: full is said only
 * when nothing is left. Quiet on purpose, so it stays out of the way of what
 * is under it; its move is clamped for those who ask for less motion.
 */
export function ProgressBar({
  label,
  value,
  total,
}: ProgressBarProps): ReactNode {
  const share = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 1;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={FULL}
      aria-valuenow={Math.floor(share * FULL)}
      className="h-1 w-full overflow-hidden rounded-full bg-line"
    >
      <div
        className="h-full origin-left bg-accent transition-transform duration-300 ease-out-expo motion-reduce:transition-none"
        style={{ transform: `scaleX(${String(share)})` }}
      />
    </div>
  );
}
