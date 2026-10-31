import type { ReactNode } from "react";

// Bar heights out of 40, drawn once: a voice, not a measurement.
const BARS = [
  6, 26, 24, 20, 28, 20, 16, 26, 20, 24, 30, 12, 20, 22, 20, 30, 26, 10, 22, 18,
  24, 32, 18, 16, 20, 18, 30, 30, 10, 18, 16, 22, 34, 24, 10, 16, 16, 28, 34,
  14, 14, 14, 20, 34, 28, 8, 12, 12,
];
const STEP = 8;
const MID = 40;

function pathOf(count: number): string {
  return BARS.slice(0, count)
    .map((height, i) => {
      const x = 4 + i * STEP;
      return `M${String(x)} ${String(MID - height / 2)}V${String(MID + height / 2)}`;
    })
    .join("");
}

interface WaveformProps {
  /** How many bars, from the left; the whole voice when left out. */
  bars?: number;
  className?: string;
}

/**
 * A drawn voice: rounded bars of uneven height, in the colour of the text
 * around it. Decoration only, so it is hidden from screen readers.
 */
export function Waveform({ bars, className }: WaveformProps): ReactNode {
  const count = Math.min(bars ?? BARS.length, BARS.length);
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${String(count * STEP)} ${String(MID * 2)}`}
      fill="none"
      className={className}
    >
      <path
        d={pathOf(count)}
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
}
