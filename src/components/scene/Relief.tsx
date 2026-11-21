import {
  animate,
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from "motion/react";
import type { MotionValue } from "motion/react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, animated } from "@/lib/motion";
import type { HoverProps } from "./HoverTip";
import type { Box, Point } from "./iso";
import { faces, project, topCentre } from "./iso";

export type Tone = "focus" | "correct" | "wrong" | "partial" | "book" | "quiet";

const STROKE: Record<Tone, string> = {
  focus: "stroke-accent",
  correct: "stroke-correct",
  wrong: "stroke-wrong",
  partial: "stroke-partial",
  book: "stroke-book",
  quiet: "stroke-ink-faint",
};

const FILL: Record<Tone, string> = {
  focus: "fill-accent",
  correct: "fill-correct",
  wrong: "fill-wrong",
  partial: "fill-partial",
  book: "fill-book",
  quiet: "fill-ink-faint",
};

const FACES: Record<"plain" | "lit" | "book", [string, string, string]> = {
  plain: ["fill-iso-top", "fill-iso-left", "fill-iso-right"],
  lit: ["fill-mint", "fill-accent-strong", "fill-accent"],
  book: ["fill-book", "fill-book-soft", "fill-book-ink"],
};

/** How a block grows or moves to a new place: a soft spring. */
const SPRING = { type: "spring", stiffness: 140, damping: 22 } as const;

/** A number that springs to each new value, or jumps there when nothing moves. */
function useSprung(target: number): MotionValue<number> {
  const reduced = useReducedMotionConfig() === true;
  const value = useMotionValue(target);
  useEffect(() => {
    if (!animated() || reduced) {
      value.set(target);
      return;
    }
    const controls = animate(value, target, SPRING);
    return () => {
      controls.stop();
    };
  }, [target, reduced, value]);
  return value;
}

interface BlockProps extends Box {
  /** `lit` is the learner's focus, raised in mint; `book` a ready chapter. */
  look?: keyof typeof FACES;
  /** Under the pointer: it lifts a little and catches the light. */
  raised?: boolean;
  /** What shows its tip, from `useHover`. */
  hover?: HoverProps;
  /** Drawn on the centre of its top, which is where (0, 0) is for them. */
  children?: ReactNode;
  /** Drawn on it in plan coordinates, lifting with it: a tint, a label. */
  decor?: ReactNode;
  className?: string;
}

/**
 * One block of a relief: its top and the two sides that face the viewer. It
 * grows and moves to a new size or place with a spring, and a lit one
 * breathes light on its top.
 */
export function Block({
  look = "plain",
  raised = false,
  hover,
  children,
  decor,
  className,
  ...box
}: BlockProps): ReactNode {
  const x = useSprung(box.x);
  const y = useSprung(box.y);
  const h = useSprung(box.h);
  const { w, d, z = 0 } = box;
  const shape = (now: readonly number[]): Box => ({
    x: now[0] ?? 0,
    y: now[1] ?? 0,
    h: now[2] ?? 0,
    w,
    d,
    z,
  });
  const top = useTransform([x, y, h], (now: number[]) => faces(shape(now)).top);
  const left = useTransform(
    [x, y, h],
    (now: number[]) => faces(shape(now)).left,
  );
  const right = useTransform(
    [x, y, h],
    (now: number[]) => faces(shape(now)).right,
  );
  const capX = useTransform(
    [x, y, h],
    (now: number[]) => topCentre(shape(now))[0],
  );
  const capY = useTransform(
    [x, y, h],
    (now: number[]) => topCentre(shape(now))[1],
  );
  const [t, l, r] = FACES[look];
  return (
    <motion.g
      {...hover}
      className={cn("stroke-iso-edge", hover?.className, className)}
      strokeWidth={0.8}
      initial={false}
      animate={{ y: raised ? -5 : 0 }}
      transition={SPRING}
    >
      <motion.polygon points={left} className={l} />
      <motion.polygon points={right} className={r} />
      <motion.polygon points={top} className={t} />
      <Presence>
        {look === "lit" && (
          <motion.g
            key="breath"
            className="pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.polygon
              points={top}
              className="animate-pulse-soft fill-iso-shine stroke-none"
              fillOpacity={0.3}
            />
          </motion.g>
        )}
      </Presence>
      <motion.g
        className="pointer-events-none fill-iso-shine stroke-none"
        initial={false}
        animate={{ opacity: raised ? 1 : 0 }}
        transition={{ duration: DURATION.enter, ease: EASE_OUT }}
      >
        <motion.polygon points={left} fillOpacity={0.12} />
        <motion.polygon points={right} fillOpacity={0.12} />
        <motion.polygon points={top} fillOpacity={0.22} />
      </motion.g>
      <g className="pointer-events-none">{decor}</g>
      <motion.g style={{ x: capX, y: capY }}>{children}</motion.g>
    </motion.g>
  );
}

/** The floor a relief stands on: a fine grid fading into the scene. */
export function Floor({
  size,
  step,
}: {
  size: number;
  step: number;
}): ReactNode {
  const lines: Array<[Point, Point]> = [];
  for (let at = 0; at <= size; at += step) {
    lines.push(
      [project(at, 0), project(at, size)],
      [project(0, at), project(size, at)],
    );
  }
  return (
    <g
      aria-hidden
      className="stroke-ink"
      strokeOpacity={0.06}
      strokeWidth={0.8}
    >
      {lines.map(([[x1, y1], [x2, y2]]) => (
        <line key={`${x1},${y1},${x2},${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
    </g>
  );
}

interface PinProps {
  /** Where its foot stands, already projected. */
  at: Point;
  tone: Tone;
  /** How far its head floats above its foot. */
  rise?: number;
  /** Under the pointer, or its block is: it lifts and its head swells. */
  raised?: boolean;
  /** What shows its tip, from `useHover`. */
  hover?: HoverProps;
}

/**
 * A pin standing on a relief, its head bobbing gently. It springs to a new
 * place rather than jumping there.
 */
export function Pin({
  at: [x, y],
  tone,
  rise = 52,
  raised = false,
  hover,
}: PinProps): ReactNode {
  return (
    <motion.g
      {...hover}
      aria-hidden
      initial={false}
      animate={{ x, y: raised ? y - 5 : y }}
      transition={SPRING}
    >
      <motion.line
        x1={0}
        y1={0}
        x2={0}
        initial={false}
        animate={{ y2: 12 - rise }}
        transition={SPRING}
        className={STROKE[tone]}
        strokeWidth={1.6}
      />
      <ellipse
        cx={0}
        cy={0}
        rx={9}
        ry={4}
        className={FILL[tone]}
        fillOpacity={0.25}
      />
      <motion.g initial={false} animate={{ y: -rise }} transition={SPRING}>
        <g className="animate-float transform-fill">
          <motion.g
            className="transform-fill"
            initial={false}
            animate={{ scale: raised ? 1.2 : 1 }}
            transition={SPRING}
          >
            <circle
              cx={0}
              cy={0}
              r={12}
              className={cn("fill-surface", STROKE[tone])}
              strokeWidth={2}
            />
            <circle cx={0} cy={0} r={4} className={FILL[tone]} />
          </motion.g>
        </g>
      </motion.g>
    </motion.g>
  );
}
