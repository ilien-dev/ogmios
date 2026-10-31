import { useMotionValue, useSpring } from "motion/react";
import type { MotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { POINTER_SPRING, useFollowsPointer } from "@/lib/motion";

/** How far the orb leans towards the pointer, in pixels. */
const MOST_LEAN = 12;
/** How far from its centre the pointer stops mattering more, in pixels. */
const REACH = 480;

interface Lean {
  x: number;
  y: number;
  /** 1 with the pointer on the orb, 0 from `REACH` on. */
  near: number;
}

/** How the orb leans with the pointer this far from its centre. */
export function orbLean(dx: number, dy: number): Lean {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return { x: 0, y: 0, near: 1 };
  }
  const pull = Math.min(distance / REACH, 1);
  return {
    x: (dx / distance) * pull * MOST_LEAN,
    y: (dy / distance) * pull * MOST_LEAN,
    near: 1 - pull,
  };
}

interface OrbPointer {
  ref: RefObject<HTMLDivElement | null>;
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** How much brighter the orb is for the pointer being close, from 0 to 1. */
  glow: MotionValue<number>;
}

/** Follows the pointer around the whole window, with a mouse and motion allowed. */
export function useOrbPointer(follow: boolean): OrbPointer {
  const ref = useRef<HTMLDivElement>(null);
  const targetX = useMotionValue(0);
  const targetY = useMotionValue(0);
  const targetGlow = useMotionValue(0);
  const x = useSpring(targetX, POINTER_SPRING);
  const y = useSpring(targetY, POINTER_SPRING);
  const glow = useSpring(targetGlow, POINTER_SPRING);
  const on = useFollowsPointer() && follow;

  useEffect(() => {
    if (!on) {
      return;
    }
    const moved = (event: PointerEvent): void => {
      const box = ref.current?.getBoundingClientRect();
      if (box === undefined) {
        return;
      }
      // Measured from where it rests, not from where it already leans.
      const lean = orbLean(
        event.clientX - (box.left + box.width / 2 - x.get()),
        event.clientY - (box.top + box.height / 2 - y.get()),
      );
      targetX.set(lean.x);
      targetY.set(lean.y);
      targetGlow.set(lean.near);
    };
    globalThis.addEventListener("pointermove", moved);
    return () => {
      globalThis.removeEventListener("pointermove", moved);
    };
  }, [on, x, y, targetX, targetY, targetGlow]);

  return { ref, x, y, glow };
}
