import { motion, useIsPresent, useReducedMotionConfig } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import { useContext } from "react";
import type { ReactNode } from "react";
import {
  REVEAL,
  STAGGER_LIMIT,
  StaggerIndex,
  animated,
} from "../../lib/motion";
import type { RevealKind } from "../../lib/motion";

type RevealTag =
  | "div"
  | "li"
  | "section"
  | "p"
  | "span"
  | "tr"
  | "main"
  | "aside"
  | "header"
  | "nav"
  | "ul"
  | "ol"
  | "dd"
  | "blockquote"
  | "mark";

interface RevealProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children?: ReactNode;
  as?: RevealTag;
  kind?: RevealKind;
  /** Position in a cascade; inside a `Stagger`, it comes from there. */
  index?: number;
}

export function Reveal({
  as = "div",
  kind = "rise",
  index,
  children,
  ...rest
}: RevealProps): ReactNode {
  const inherited = useContext(StaggerIndex);
  const position = index ?? inherited;
  const isPresent = useIsPresent();
  const reduced = useReducedMotionConfig();
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag
      {...rest}
      // Motion makes a transform instant under reduced motion, so an exit that
      // moves would jump and then fade. Rows past the cascade only fade too.
      variants={
        reduced === true || position >= STAGGER_LIMIT
          ? REVEAL.fade
          : REVEAL[kind]
      }
      custom={position}
      initial={animated() ? "hidden" : false}
      animate="shown"
      exit="gone"
      inert={!isPresent}
    >
      {/* What comes in later inside this one owes nothing to its place here. */}
      <StaggerIndex.Provider value={0}>{children}</StaggerIndex.Provider>
    </Tag>
  );
}
