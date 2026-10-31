import { motion, useIsPresent, useReducedMotionConfig } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import { useContext } from "react";
import type { ReactNode } from "react";
import { REVEAL, StaggerIndex, animated } from "../../lib/motion";
import type { RevealKind } from "../../lib/motion";

type RevealTag = "div" | "li" | "section" | "p" | "span" | "tr" | "main";

interface RevealProps extends HTMLMotionProps<"div"> {
  as?: RevealTag;
  kind?: RevealKind;
  /** Position in a cascade; inside a `Stagger`, it comes from there. */
  index?: number;
}

export function Reveal({
  as = "div",
  kind = "rise",
  index,
  ...rest
}: RevealProps): ReactNode {
  const position = useContext(StaggerIndex);
  const isPresent = useIsPresent();
  const reduced = useReducedMotionConfig();
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag
      {...rest}
      // Motion makes a transform instant under reduced motion, so an exit that
      // moves would jump and then fade. A fade alone is what the spec keeps.
      variants={reduced === true ? REVEAL.fade : REVEAL[kind]}
      custom={index ?? position}
      initial={animated() ? "hidden" : false}
      animate="shown"
      exit="gone"
      inert={!isPresent}
    />
  );
}
