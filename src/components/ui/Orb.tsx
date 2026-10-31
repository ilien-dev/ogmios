import {
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from "motion/react";
import type { MotionValue } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useOrbPointer } from "./useOrbPointer";

export type OrbState = "idle" | "listening" | "thinking";

type OrbSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZES: Record<OrbSize, string> = {
  xs: "size-8",
  sm: "size-10",
  md: "size-24",
  lg: "size-40",
  xl: "size-50",
};

/** Listening at full voice, as a scale of the orb. */
const LOUDEST = 1.12;

interface OrbProps {
  size: OrbSize;
  section?: "partner" | "book";
  state?: OrbState;
  /** How loud the learner is, from 0 to 1, to beat with while listening. */
  level?: MotionValue<number>;
  /** Travels to the orb of the next screen. */
  shared?: boolean;
  /** Leans towards the pointer and brightens as it comes close. */
  follow?: boolean;
  className?: string;
}

function ballMotion(state: OrbState, beatsAlone: boolean): string {
  if (state === "thinking") {
    return "animate-orb-spin";
  }
  return beatsAlone ? "animate-orb-pulse" : "animate-orb-drift";
}

/**
 * The partner, or its warm twin for the book. Decoration: what it says is
 * always said in words too. The ball is its own layer so that its loop never
 * meets the transforms of the shell, nor turns the shell's shadow with it.
 */
export function Orb({
  size,
  section = "partner",
  state = "idle",
  level,
  shared = false,
  follow = false,
  className,
}: OrbProps): ReactNode {
  const { ref, x, y, glow } = useOrbPointer(follow);
  const reduced = useReducedMotionConfig();
  const silence = useMotionValue(0);
  const swell = useTransform(level ?? silence, [0, 1], [1, LOUDEST]);
  const listening = state === "listening";
  const book = section === "book";
  const shadow = book ? "shadow-glow-book" : "shadow-glow";
  const sharedId = book ? "orb-book" : "orb";

  return (
    <motion.div
      ref={ref}
      aria-hidden
      layoutId={shared ? sharedId : undefined}
      style={{ x, y, scale: listening && reduced !== true ? swell : 1 }}
      className={cn(
        "relative shrink-0 rounded-full",
        SIZES[size],
        (size === "lg" || size === "xl") && shadow,
        className,
      )}
    >
      {follow && (
        <motion.div
          style={{ opacity: glow }}
          className={cn("absolute inset-0 rounded-full", shadow)}
        />
      )}
      <div
        className={cn(
          "size-full rounded-full",
          book ? "bg-orb-book" : "bg-orb",
          ballMotion(state, listening && level === undefined),
        )}
      />
    </motion.div>
  );
}
