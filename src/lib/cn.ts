import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose Tailwind class lists.
 *
 * `clsx` handles conditionals and arrays; `twMerge` then resolves conflicts so a
 * caller-supplied class wins over a component default (`cn("p-2", props.className)`
 * with `className="p-4"` yields `p-4`, not both). Without the merge step, the
 * later class only wins by CSS source order, which is not something a component
 * API should depend on.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
