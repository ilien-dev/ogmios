import { animate, useReducedMotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DURATION, EASE_OUT, animated } from "../../lib/motion";

interface CountUpProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
  /** Where it counts from when it first appears; without it, it starts on its value. */
  from?: number;
}

/** A number that counts to its value when the value changes, and on arrival from `from`. */
export function CountUp({
  value,
  format = String,
  className,
  from: start,
}: CountUpProps): ReactNode {
  const reduced = useReducedMotionConfig();
  const still = !animated() || reduced === true;
  const [counted, setCounted] = useState(start ?? value);
  const from = useRef(start ?? value);

  useEffect(() => {
    if (still) {
      from.current = value;
      setCounted(value);
      return;
    }
    if (from.current === value) {
      return;
    }
    // A whole target counts in whole steps; a fractional one keeps its fraction
    // all the way, so it never reads a rounded value and then snaps.
    const whole = Number.isInteger(value);
    const controls = animate(from.current, value, {
      duration: DURATION.enterSlow,
      ease: EASE_OUT,
      onUpdate: (n) => {
        from.current = n;
        setCounted(whole ? Math.round(n) : n);
      },
      onComplete: () => {
        from.current = value;
        setCounted(value);
      },
    });
    return () => {
      controls.stop();
    };
  }, [value, still]);

  return <span className={className}>{format(still ? value : counted)}</span>;
}
