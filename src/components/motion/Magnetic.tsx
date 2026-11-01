import { motion, useMotionValue, useSpring } from "motion/react";
import type { PointerEvent, ReactNode } from "react";
import {
  POINTER_SPRING,
  pointerOffset,
  useFollowsPointer,
} from "../../lib/motion";

const MAX_PIXELS = 6;

interface MagneticProps {
  className?: string;
  children: ReactNode;
}

/** Drifts slightly towards the mouse. */
export function Magnetic({ className, children }: MagneticProps): ReactNode {
  const follows = useFollowsPointer();
  const pullX = useMotionValue(0);
  const pullY = useMotionValue(0);
  const x = useSpring(pullX, POINTER_SPRING);
  const y = useSpring(pullY, POINTER_SPRING);

  function pull(event: PointerEvent<HTMLDivElement>): void {
    if (follows) {
      const offset = pointerOffset(event);
      pullX.set(offset.x * MAX_PIXELS);
      pullY.set(offset.y * MAX_PIXELS);
    }
  }

  function release(): void {
    pullX.set(0);
    pullY.set(0);
  }

  return (
    <motion.div
      className={className}
      style={{ x, y }}
      onPointerMove={pull}
      onPointerLeave={release}
    >
      {children}
    </motion.div>
  );
}
