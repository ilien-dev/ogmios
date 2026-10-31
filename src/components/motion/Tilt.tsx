import { motion, useMotionValue, useSpring } from "motion/react";
import type { PointerEvent, ReactNode } from "react";
import {
  POINTER_SPRING,
  pointerOffset,
  useFollowsPointer,
} from "../../lib/motion";

const MAX_DEGREES = 3;
const transformPerspective = 800;

interface TiltProps {
  className?: string;
  children: ReactNode;
}

/** Leans slightly towards the mouse. */
export function Tilt({ className, children }: TiltProps): ReactNode {
  const follows = useFollowsPointer();
  const pitch = useMotionValue(0);
  const yaw = useMotionValue(0);
  const rotateX = useSpring(pitch, POINTER_SPRING);
  const rotateY = useSpring(yaw, POINTER_SPRING);

  function lean(event: PointerEvent<HTMLDivElement>): void {
    if (follows) {
      const { x, y } = pointerOffset(event);
      pitch.set(-y * MAX_DEGREES);
      yaw.set(x * MAX_DEGREES);
    }
  }

  function settle(): void {
    pitch.set(0);
    yaw.set(0);
  }

  return (
    <motion.div
      className={className}
      style={follows ? { rotateX, rotateY, transformPerspective } : {}}
      onPointerMove={lean}
      onPointerLeave={settle}
    >
      {children}
    </motion.div>
  );
}
