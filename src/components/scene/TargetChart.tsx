import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import { DURATION, EASE_OUT } from "@/lib/motion";

interface TargetChartProps {
  /** The values, oldest first. */
  values: readonly number[];
  /** The line to reach, drawn dashed. */
  target?: number;
  /** The top of the scale. */
  max: number;
  /** A label under each value, in mono. */
  labels?: readonly string[];
  /** Read out instead of the drawing. */
  label: string;
}

const W = 420;
const H = 150;
const LEFT = 8;
const RIGHT = 384;
const TOP = 14;
const BASE = 118;

/**
 * A line climbing towards a dashed target, as in the proposal: the last value
 * lit in mint, the line drawing itself in as it arrives.
 */
export function TargetChart({
  values,
  target,
  max,
  labels = [],
  label,
}: TargetChartProps): ReactNode {
  const top = Math.max(max, target ?? 0, ...values, 1);
  const y = (v: number): number => BASE - (v / top) * (BASE - TOP);
  const x = (at: number): number =>
    values.length < 2
      ? RIGHT
      : LEFT + (at / (values.length - 1)) * (RIGHT - LEFT);
  const path = values
    .map(
      (v, at) =>
        `${at === 0 ? "M" : "L"}${x(at).toFixed(1)} ${y(v).toFixed(1)}`,
    )
    .join("");
  const last = values.length - 1;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={label}
    >
      {[0.5, 1].map((part) => (
        <path
          key={part}
          d={`M${LEFT} ${y(top * part)}H${RIGHT}`}
          className="stroke-ink"
          strokeOpacity={0.06}
        />
      ))}
      <Presence>
        {target !== undefined && (
          <motion.g
            key="target"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{
              opacity: 0,
              transition: { duration: DURATION.exit, ease: EASE_OUT },
            }}
          >
            <path
              d={`M${LEFT} ${y(target)}H${RIGHT}`}
              className="stroke-ink"
              strokeOpacity={0.45}
              strokeDasharray="5 6"
            />
            <text
              x={RIGHT + 8}
              y={y(target) + 4}
              className="fill-ink-faint font-mono text-xs"
            >
              {target}
            </text>
          </motion.g>
        )}
      </Presence>
      <Presence>
        {values.length > 0 && (
          <motion.path
            key="line"
            d={path}
            fill="none"
            className="stroke-ink-soft"
            strokeWidth={1.6}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            exit={{
              opacity: 0,
              transition: { duration: DURATION.exit, ease: EASE_OUT },
            }}
            transition={{ duration: 1.2, ease: EASE_OUT }}
          />
        )}
      </Presence>
      {values.map((v, at) =>
        at === last ? (
          <circle
            key={at}
            cx={x(at)}
            cy={y(v)}
            r={5}
            className="animate-breathe fill-mint transform-fill"
          />
        ) : (
          <circle
            key={at}
            cx={x(at)}
            cy={y(v)}
            r={3.5}
            className="fill-frame stroke-ink"
            strokeWidth={1.4}
          />
        ),
      )}
      {labels.map((text, at) => (
        <text
          key={`${text}-${at}`}
          x={x(at)}
          y={H - 6}
          textAnchor="middle"
          className="fill-ink-faint font-mono text-xs uppercase"
        >
          {text}
        </text>
      ))}
    </svg>
  );
}
