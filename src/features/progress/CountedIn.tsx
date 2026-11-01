import { useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CountUp } from "@/components/motion/CountUp";
import { animated } from "@/lib/motion";

/** A number that counts up from zero as it comes onto the screen. */
export function CountedIn({ value }: { value: number }): ReactNode {
  const reduced = useReducedMotionConfig();
  const still = !animated() || reduced === true;
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    setEntered(true);
  }, []);

  return <CountUp value={entered || still ? value : 0} />;
}
