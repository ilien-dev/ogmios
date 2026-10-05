import { useId, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** `className` and the rest go to what is hovered, not to the tooltip. */
interface TooltipProps extends Omit<ComponentProps<"button">, "type"> {
  /** What the tooltip says: a few words. */
  hint: string;
}

/**
 * A few words about what it wraps, shown under it on hover, focus or a tap,
 * and put away on leaving or Escape. Mounted only while shown.
 */
export function Tooltip({
  hint,
  className,
  children,
  ...rest
}: TooltipProps): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  const show = (): void => {
    setOpen(true);
  };
  const hide = (): void => {
    setOpen(false);
  };
  return (
    <span className="relative inline-flex">
      <button
        {...rest}
        type="button"
        aria-describedby={open ? id : undefined}
        className={cn("cursor-help", className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.stopPropagation();
            hide();
          }
        }}
      >
        {children}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute top-full left-0 z-20 mt-1.5 w-max max-w-56 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left text-xs font-normal text-ink-soft normal-case shadow-float motion-safe:animate-fade"
        >
          {hint}
        </span>
      )}
    </span>
  );
}
