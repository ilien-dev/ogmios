import type { ReactNode } from "react";

/**
 * The light behind the glass: two soft glows, mint and lavender, that wander
 * for ever under every screen. It takes no click and says nothing.
 */
export function Ambient(): ReactNode {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute -top-40 -left-32 size-144 animate-ambient-a rounded-full bg-mint/18 blur-3xl" />
      <div className="absolute -right-40 -bottom-48 size-136 animate-ambient-b rounded-full bg-partner/14 blur-3xl" />
    </div>
  );
}
