import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Each card's heading. It takes focus when the card appears, so a screen
 * reader announces the new card and Tab starts from its top.
 */
export function CardTitle({ children }: { children: ReactNode }): ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h2
      ref={heading}
      tabIndex={-1}
      className="text-title font-semibold text-balance text-ink focus:outline-none"
    >
      {children}
    </h2>
  );
}
