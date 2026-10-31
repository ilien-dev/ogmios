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
      return;
    }
    if (from.current === value) {
      return;
    }
    const controls = animate(from.current, value, {
      duration: DURATION.enterSlow,
      ease: EASE_OUT,
      onUpdate: (n) => {
        from.current = n;
        setCounted(Math.round(n));
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
