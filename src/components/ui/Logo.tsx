import type { ReactNode } from "react";

interface LogoProps {
  className?: string;
}

/**
 * The app icon (assets/icon.svg): two voices closing an O on a teal square.
 * Its colours are the same in both themes, like the icon's. It sits beside the
 * app's name, so screen readers skip it.
 */
export function Logo({ className }: LogoProps): ReactNode {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className}>
      <rect width="16" height="16" rx="2" className="fill-logo" />
      <path d="M2 2H10V5H5V10H2Z" className="fill-logo-first" />
      <path d="M14 14H6V11H11V6H14Z" className="fill-logo-second" />
    </svg>
  );
}
