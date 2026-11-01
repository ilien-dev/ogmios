import { AnimatePresence } from "motion/react";
import type { ReactNode } from "react";
import { animated } from "../../lib/motion";

interface PresenceProps {
  /** The new element comes in at once, without waiting for the old to leave. */
  swap?: boolean;
  /** What is there when this mounts is there at once; only changes animate. */
  firstStatic?: boolean;
  children: ReactNode;
}

/** Keeps what React unmounts on screen until its exit ends. */
export function Presence({
  swap = false,
  firstStatic = false,
  children,
}: PresenceProps): ReactNode {
  if (!animated()) {
    return children;
  }
  return (
    <AnimatePresence mode={swap ? "popLayout" : "sync"} initial={!firstStatic}>
      {children}
    </AnimatePresence>
  );
}
