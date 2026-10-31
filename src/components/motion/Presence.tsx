import { AnimatePresence } from "motion/react";
import type { ReactNode } from "react";
import { animated } from "../../lib/motion";

interface PresenceProps {
  /** The new element comes in at once, without waiting for the old to leave. */
  swap?: boolean;
  children: ReactNode;
}

/** Keeps what React unmounts on screen until its exit ends. */
export function Presence({ swap = false, children }: PresenceProps): ReactNode {
  if (!animated()) {
    return children;
  }
  return (
    <AnimatePresence mode={swap ? "popLayout" : "sync"}>
      {children}
    </AnimatePresence>
  );
}
