import { animate, useReducedMotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DURATION, EASE_OUT, animated } from "../../lib/motion";

interface CountUpProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
}

/** A number that counts to its value when the value changes. */
export function CountUp({
  value,
  format = String,
  className,
}: CountUpProps): ReactNode {
  const reduced = useReducedMotionConfig();
  const still = !animated() || reduced === true;
  const [counted, setCounted] = useState(value);
  const from = useRef(value);

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
    const whole = Number.isInteger(value) && Number.isInteger(from.current);
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
