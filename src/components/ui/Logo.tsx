import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface LogoProps {
  className?: string;
}

/**
 * The mark (assets/brand): a square spiral that winds in like an ear, with a
 * mint square at its centre, which breathes. It sits beside the app's name,
 * so screen readers skip it.
 */
export function Logo({ className }: LogoProps): ReactNode {
  return (
    <svg
      aria-hidden
      viewBox="0 0 256 256"
      className={cn("shrink-0", className)}
    >
      <path
        className="fill-logo-first"
        d="M80 54L202 54L202 202L54 202L54 98L158 98L158 158L98 158L98 116L72 116L72 184L184 184L184 72L28 72L28 228L228 228L228 28L80 28Z"
      />
      <path
        className="origin-center animate-breathe fill-logo-second transform-fill"
        d="M114 113H146V145H114Z"
      />
    </svg>
  );
}
