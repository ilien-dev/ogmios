import { motion, useReducedMotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import type { Box } from "@/components/scene/iso";
import { project, topCentre } from "@/components/scene/iso";
import { ReliefFrame, useHover } from "@/components/scene/HoverTip";
import type { Tone } from "@/components/scene/Relief";
import { Block, Floor, Pin } from "@/components/scene/Relief";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, animated } from "@/lib/motion";
import { towerHeight } from "./todayQueue";

/** A piece of the day: a tower of the review, or the way into a place. */
export interface TodayPiece {
  key: string;
  /** What it says on its top: a count, or a place's name. */
  label: string;
  /** How many come back, for a tower; null for a place, which lies low. */
  count: number | null;
  /** The one the review starts with: lit, with the pin over it. */
  next?: boolean;
  look?: "plain" | "book";
  /** What it tells under the pointer. */
  title: string;
  lines: readonly string[];
  onPick: () => void;
}

interface TodayReliefProps {
  /** The three towers of the review, in order. */
  towers: readonly TodayPiece[];
  /** The two places to go on in, in front of them. */
  places: readonly TodayPiece[];
  /** The piece pointed at from outside the relief: it rises too. */
  pointed: string | null;
  /** Read out instead of the drawing. */
  label: string;
  className?: string;
}

const SIDE = 60;
const SIZE = 260;
/** The towers stand in a row across the back; the places lie in front. */
const TOWERS: ReadonlyArray<readonly [number, number]> = [
  [10, 170],
  [90, 90],
  [170, 10],
];
const PLACES: ReadonlyArray<Omit<Box, "h">> = [
  { x: 100, y: 190, w: 84, d: 56 },
  { x: 190, y: 100, w: 56, d: 84 },
];
const LOW = 9;
const TALL = 96;

const NUMBER: Record<"plain" | "lit" | "book", string> = {
  plain: "fill-ink-soft",
  lit: "fill-on-cta",
  book: "fill-canvas",
};

interface Placed {
  piece: TodayPiece;
  box: Box;
  look: "plain" | "lit" | "book";
  order: number;
  pin: Tone | null;
}

/** Back to front, so the nearer piece covers the farther. */
function nearLast(placed: readonly Placed[]): Placed[] {
  return [...placed].sort((a, b) => a.box.x + a.box.y - (b.box.x + b.box.y));
}

/**
 * The day raised as a relief: a tower for each kind of the daily review, as
 * tall as what comes back of it, the one to start with lit in mint with a pin
 * over it, and the book and the conversation as two low platforms in front.
 * Every piece tells what it is under the pointer and starts it when pressed.
 */
export function TodayRelief({
  towers,
  places,
  pointed,
  label,
  className,
}: TodayReliefProps): ReactNode {
  const hover = useHover();
  const reduced = useReducedMotionConfig() === true;
  const rise = animated() && !reduced;
  const placed: Placed[] = [
    ...towers.map((piece, order) => {
      const [x, y] = TOWERS[order] ?? [0, 0];
      return {
        piece,
        order,
        box: { x, y, w: SIDE, d: SIDE, h: towerHeight(piece.count ?? 0) },
        look: piece.next === true ? ("lit" as const) : ("plain" as const),
        pin:
          piece.next === true
            ? ("focus" as const)
            : (piece.count ?? 0) > 0
              ? ("quiet" as const)
              : null,
      };
    }),
    ...places.map((piece, at) => ({
      piece,
      order: towers.length + at,
      box: { ...(PLACES[at] ?? { x: 0, y: 0, w: SIDE, d: SIDE }), h: LOW },
      look: piece.look ?? ("plain" as const),
      pin: null,
    })),
  ];
  const [left] = project(0, SIZE);
  const [right] = project(SIZE, 0);
  const [, top] = project(0, 0, TALL);
  const [, bottom] = project(SIZE, SIZE);
  const lit = placed.find((each) => each.look === "lit");
  const glow =
    lit === undefined
      ? null
      : project(lit.box.x + SIDE / 2, lit.box.y + SIDE / 2);
  return (
    <ReliefFrame hover={hover} className={className}>
      <svg
        viewBox={`${left - 16} ${top - 70} ${right - left + 32} ${bottom - top + 84}`}
        role="img"
        aria-label={label}
        className="block size-full"
      >
        <Floor size={SIZE} step={26} />
        <Presence>
          {glow !== null && (
            <motion.g
              key="glow"
              initial={rise ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: DURATION.exit, ease: EASE_OUT },
              }}
            >
              <ellipse
                cx={glow[0]}
                cy={glow[1]}
                rx={64}
                ry={32}
                className="animate-breathe fill-mint transform-fill"
                fillOpacity={0.18}
              />
            </motion.g>
          )}
        </Presence>
        {nearLast(placed).map(({ piece, box, look, order, pin }) => {
          const raised = hover.hovered === piece.key || pointed === piece.key;
          const hovers = hover.on(
            { key: piece.key, title: piece.title, lines: piece.lines },
            piece.onPick,
          );
          return (
            <motion.g
              key={piece.key}
              initial={rise ? { opacity: 0, y: 36 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                ease: EASE_OUT,
                delay: 0.15 + order * 0.08,
              }}
            >
              <Block {...box} look={look} raised={raised} hover={hovers}>
                <text
                  y={4}
                  textAnchor="middle"
                  aria-hidden
                  className={cn(
                    "pointer-events-none font-mono text-xs font-semibold transition-control",
                    NUMBER[look],
                  )}
                >
                  {piece.label}
                </text>
              </Block>
              <Presence>
                {pin !== null && (
                  <motion.g
                    key="pin"
                    className="pointer-events-none"
                    initial={rise ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    exit={{
                      opacity: 0,
                      transition: { duration: DURATION.exit, ease: EASE_OUT },
                    }}
                    transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.5 }}
                  >
                    <Pin
                      at={topCentre(box)}
                      tone={pin}
                      rise={pin === "focus" ? 58 : 44}
                      raised={raised}
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
