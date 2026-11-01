import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface LogoProps {
  className?: string;
}

/**
 * The app icon (assets/icon.svg): the partner's orb with two voices closing an
 * O inside it. Its colours are the same in both themes, like the icon's. It
 * sits beside the app's name, so screen readers skip it.
 */
export function Logo({ className }: LogoProps): ReactNode {
  return (
    <svg
      aria-hidden
      viewBox="2 2 60 60"
      fill="none"
      strokeWidth={8}
      strokeLinecap="round"
      className={cn("rounded-full bg-orb", className)}
    >
      <path
        d="M19.5 37A13.5 13.5 0 0 1 37 19.5"
        className="stroke-logo-first"
      />
      <path
        d="M44.5 27A13.5 13.5 0 0 1 27 44.5"
        className="stroke-logo-second"
      />
    </svg>
  );
}
