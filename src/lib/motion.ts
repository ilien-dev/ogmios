import { MotionGlobalConfig, useReducedMotionConfig } from "motion/react";
import type { Variants } from "motion/react";
import { createContext } from "react";
import type { PointerEvent } from "react";

export const DURATION = {
  enter: 0.3,
  enterSlow: 0.45,
  exit: 0.18,
  exitFast: 0.12,
};
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const STAGGER_STEP = 0.04;
export const STAGGER_LIMIT = 12;

export const POINTER_SPRING = { stiffness: 200, damping: 20 };

export type RevealKind = "rise" | "fade" | "scale" | "slide";

type Pose = Record<string, number>;

/**
 * Timings sit inside the variants rather than on `MotionConfig`, which holds one
 * transition: exits would run at entry speed. `shown` takes the position in a
 * cascade through `custom`.
 */
function reveal(hidden: Pose, rest: Pose, gone: Pose): Variants {
  return {
    hidden: { opacity: 0, ...hidden },
    shown: (position: number) => ({
      opacity: 1,
      ...rest,
      transition: {
        duration: DURATION.enter,
        ease: EASE_OUT,
        delay: staggerDelay(position),
      },
    }),
    gone: {
      opacity: 0,
      ...gone,
      transition: { duration: DURATION.exit, ease: EASE_OUT },
    },
  };
}

export const REVEAL: Record<RevealKind, Variants> = {
  rise: reveal({ y: 8 }, { y: 0 }, { y: -4 }),
  fade: reveal({}, {}, {}),
  scale: reveal({ scale: 0.97 }, { scale: 1 }, { scale: 0.98 }),
  slide: reveal({ x: 12 }, { x: 0 }, { x: -8 }),
};

/** The position of a `Reveal` in the `Stagger` around it. */
export const StaggerIndex = createContext(0);

/** Read at render, never at module load: tests flip the flag between renders. */
export function animated(): boolean {
  return MotionGlobalConfig.skipAnimations !== true;
}

export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_LIMIT) * STAGGER_STEP;
}

/** Whether something may follow the pointer: a mouse, and motion allowed. */
export function useFollowsPointer(): boolean {
  const reduced = useReducedMotionConfig();
  return (
    animated() &&
    reduced !== true &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

/** Where the pointer is over the element, from -1 to 1 on each axis. */
export function pointerOffset(event: PointerEvent<HTMLElement>): {
  x: number;
  y: number;
} {
  const box = event.currentTarget.getBoundingClientRect();
  const along = (distance: number, size: number): number =>
    Math.max(-1, Math.min(1, (distance / size) * 2 - 1));
  return {
    x: along(event.clientX - box.left, box.width),
    y: along(event.clientY - box.top, box.height),
  };
}
