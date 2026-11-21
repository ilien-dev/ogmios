import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const FULL = 100;

interface ProgressBarProps {
  /** What the bar measures, for a screen reader: it shows no text. */
  label: string;
  /** How far, out of `total`. Nothing to count is as far as it goes. */
  value: number;
  total: number;
  /** Book screens fill in the book's warm colour. */
  tone?: "accent" | "book";
}

/**
 * A thin bar that says how far something is, and goes back as well as on.
 * It is announced as a whole percentage, rounded down: full is said only
 * when nothing is left. Its track is drawn in the ink, not a surface, so it
 * stays in sight over any background, glows included, from its first word;
 * its move is clamped for those who ask for less motion.
 */
export function ProgressBar({
  label,
  value,
  total,
  tone = "accent",
}: ProgressBarProps): ReactNode {
  const share = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 1;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={FULL}
      aria-valuenow={Math.floor(share * FULL)}
      className="h-2 w-full overflow-hidden rounded-full bg-ink/12"
    >
      <div
        className={cn(
          "h-full origin-left transition-transform duration-300 ease-out-expo motion-reduce:transition-none",
          tone === "book" ? "bg-book" : "bg-accent",
        )}
        style={{ transform: `scaleX(${String(share)})` }}
      />
    </div>
  );
}
