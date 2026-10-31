import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Set for a toggle; leave undefined for a chip that is a plain action. */
  selected?: boolean;
}

export function Chip({
  selected,
  className,
  children,
  ...rest
}: ChipProps): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm transition duration-150",
        selected === true
          ? "bg-accent-soft text-ink"
          : "bg-raised text-ink-soft hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
