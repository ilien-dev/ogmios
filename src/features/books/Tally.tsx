import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** How many words stand one way, beside a dot of that way's colour. */
export function Tally({
  dot,
  children,
}: {
  dot: string;
  children: string;
}): ReactNode {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-ink-soft">
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {children}
    </p>
  );
}
