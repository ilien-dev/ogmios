import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";

/** `className` and the rest go to what is hovered, not to the tooltip. */
interface TooltipProps extends Omit<ComponentProps<"button">, "type"> {
  /** What the tooltip says: a few words. Empty, there is no tooltip. */
  hint: string;
}

/** Space between the tooltip and what it wraps, and the window's edge. */
const GAP = 6;
const MARGIN = 8;

interface Place {
  left: number;
  top: number;
}

/**
 * Under the trigger, kept inside the window: moved left when it would cross
 * the right edge, and over the trigger when there is no room under it.
 */
function placeOf(trigger: DOMRect, tip: DOMRect): Place {
  const right = window.innerWidth - MARGIN - tip.width;
  const left = Math.max(MARGIN, Math.min(trigger.left, right));
  const below = trigger.bottom + GAP;
  const fits = below + tip.height <= window.innerHeight - MARGIN;
  const top = fits ? below : Math.max(MARGIN, trigger.top - GAP - tip.height);
  return { left, top };
}

/**
 * A few words about what it wraps, shown under it on hover, focus or a tap,
 * and put away on leaving or Escape. Mounted only while shown, in the body,
 * so no box that clips its content can hide it.
 */
export function Tooltip({
  hint,
  className,
  children,
  ...rest
}: TooltipProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // A span, but `Reveal` types every ref as a div's; only its box is read.
  const tip = useRef<HTMLDivElement>(null);
  const id = useId();
  const show = (): void => {
    setOpen(true);
  };
  const hide = (): void => {
    setOpen(false);
    setPlace(null);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      if (trigger.current === null || tip.current === null) return;
      setPlace(
        placeOf(
          trigger.current.getBoundingClientRect(),
          tip.current.getBoundingClientRect(),
        ),
      );
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  if (hint === "") {
    return (
      <span className={className} lang={rest.lang}>
        {children}
      </span>
    );
  }
  return (
    <span className="inline-flex">
      <button
        {...rest}
        ref={trigger}
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
      {createPortal(
        <Presence>
          {open && (
            <Reveal
              key="hint"
              ref={tip}
              as="span"
              kind="fade"
              id={id}
              role="tooltip"
              // Measured before it is painted: hidden until it has a place.
              style={
                place === null
                  ? { left: 0, top: 0, visibility: "hidden" }
                  : { left: place.left, top: place.top }
              }
              className="pointer-events-none fixed z-50 w-max max-w-56 rounded-md bg-surface px-2.5 py-1.5 text-left text-xs font-normal text-ink-soft normal-case shadow-float"
            >
              {hint}
            </Reveal>
          )}
        </Presence>,
        document.body,
      )}
    </span>
  );
}
