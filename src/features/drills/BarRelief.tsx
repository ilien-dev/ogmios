import { motion } from "motion/react";
import type { ReactNode } from "react";
import { ReliefFrame, useHover } from "@/components/scene/HoverTip";
import type { Box } from "@/components/scene/iso";
import { byDepth, project, topCentre } from "@/components/scene/iso";
import type { Tone } from "@/components/scene/Relief";
import { Block, Floor, Pin } from "@/components/scene/Relief";
import { Presence } from "@/components/motion/Presence";
import { cn } from "@/lib/cn";
import { animated, EASE_OUT } from "@/lib/motion";

/** One column of the relief. */
export interface ReliefBar {
  key: string;
  /** How tall it stands, against the tallest of the relief. */
  value: number;
  /** `lit` raises it in mint, the one that matters now; `book` in teal. */
  look?: "plain" | "lit" | "book";
  /** A pin on its top, in this tone. */
  pin?: Tone;
  /** What it tells under the pointer: its name and its count. */
  tip?: { title: string; lines: readonly string[] };
}

interface BarReliefProps {
  bars: readonly ReliefBar[];
  /** Read out instead of the drawing. */
  label: string;
  className?: string;
}

const WIDTH = 48;
const GAP = 26;
const DEPTH = 48;
const BASE = 8;
const LOW = 10;
const TALL = 120;

/** How a glow or a pin comes onto a column, and leaves it. */
const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.4, ease: EASE_OUT },
} as const;

/**
 * Columns standing on a plinth, seen in 3D: one per thing a screen counts,
 * each as tall as its share of the tallest. They rise in one after the other,
 * grow as their counts change, and tell their count under the pointer.
 */
export function BarRelief({
  bars,
  label,
  className,
}: BarReliefProps): ReactNode {
  const top = Math.max(1, ...bars.map((bar) => bar.value));
  const length = bars.length * (WIDTH + GAP) + GAP;
  const plinth: Box = { x: 0, y: 0, w: length, d: DEPTH + GAP * 2, h: BASE };
  const columns = bars.map((bar, at) => ({
    bar,
    box: {
      x: GAP + at * (WIDTH + GAP),
      y: GAP,
      w: WIDTH,
      d: DEPTH,
      h: LOW + (Math.max(0, bar.value) / top) * TALL,
      z: BASE,
    } satisfies Box,
  }));
  const floor = Math.max(length, plinth.d) + 64;
  const [left] = project(0, floor);
  const [right] = project(floor, 0);
  const [, high] = project(0, 0, BASE + LOW + TALL + 60);
  const [, low] = project(floor, floor);
  const moving = animated();
  const hover = useHover();

  return (
    <ReliefFrame hover={hover} className={className}>
      <svg
        viewBox={`${left - 24} ${high - 24} ${right - left + 48} ${low - high + 48}`}
        role="img"
        aria-label={label}
        className="block size-full"
      >
        <Floor size={floor} step={16} />
        <Block {...plinth} />
        {byDepth(columns.map(({ box }) => box)).map((box) => {
          const at = columns.findIndex((column) => column.box === box);
          const bar = columns[at]?.bar;
          const key = bar?.key ?? String(at);
          const tip = bar?.tip;
          const hovers =
            tip === undefined ? undefined : hover.on({ key, ...tip });
          return (
            <motion.g
              key={key}
              initial={moving ? { opacity: 0, y: 24 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE_OUT, delay: at * 0.08 }}
            >
              <Presence>
                {(bar?.look === "lit" || bar?.look === "book") && (
                  <motion.g key="glow" {...FADE}>
                    <ellipse
                      cx={topCentre(box)[0]}
                      cy={
                        project(box.x + box.w / 2, box.y + box.d / 2, BASE)[1]
                      }
                      rx={WIDTH}
                      ry={WIDTH / 2}
                      className={cn(
                        "animate-breathe transform-fill",
                        bar.look === "lit" ? "fill-mint" : "fill-book",
                      )}
                      fillOpacity={0.16}
                    />
                  </motion.g>
                )}
              </Presence>
              <Block
                {...box}
                look={bar?.look ?? "plain"}
                raised={hover.hovered === key}
                hover={hovers}
              />
              <Presence>
                {bar?.pin !== undefined && (
                  <motion.g key="pin" {...FADE}>
                    <Pin
                      at={topCentre(box)}
                      tone={bar.pin}
                      rise={40}
                      raised={hover.hovered === key}
                      hover={hovers}
                    />
                  </motion.g>
                )}
              </Presence>
            </motion.g>
          );
        })}
      </svg>
    </ReliefFrame>
  );
}
