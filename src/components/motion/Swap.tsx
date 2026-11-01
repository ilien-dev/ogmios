import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Presence } from "./Presence";
import { Reveal } from "./Reveal";

interface SwapProps {
  /** Names what is showing: a new name fades in over the last. */
  id: string;
  /** `div` for a whole view; the default is for something small in a line. */
  as?: "span" | "div";
  className?: string;
  children: ReactNode;
}

/**
 * One thing at a time in the same spot: an icon in a button, or a view that
 * gives way to the next, as loading does to what it was loading.
 */
export function Swap({
  id,
  as = "span",
  className,
  children,
}: SwapProps): ReactNode {
  return (
    <Presence swap>
      <Reveal
        key={id}
        as={as}
        kind="fade"
        index={0}
        className={cn(as === "span" && "inline-flex", className)}
      >
        {children}
      </Reveal>
    </Presence>
  );
}
