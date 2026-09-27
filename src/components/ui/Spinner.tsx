import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }): ReactNode {
  return (
    <LoaderCircle
      aria-hidden
      className={cn("size-4 animate-spin text-ink-faint", className)}
    />
  );
}
