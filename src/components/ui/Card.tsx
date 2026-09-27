import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A raised surface. Never nest one inside another. */
export function Card({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface shadow-card",
        className,
      )}
      {...rest}
    />
  );
}
