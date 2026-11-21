import { motion, useReducedMotionConfig } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { PointerEvent, ReactNode, RefObject } from "react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT } from "@/lib/motion";

/**
 * The glass layer a scene keeps over everything it holds, header and cards
 * included, where the tips of its relief float. Outside a scene, a tip floats
 * in its relief's own frame.
 */
export const TipLayer = createContext<HTMLElement | null>(null);

/** What a piece of a relief tells when the pointer rests on it. */
export interface Tip {
  /** Names the piece: the tip slides to a new one and its words cross-fade. */
  key: string;
  title: string;
  lines: readonly string[];
}

/** What a piece of a relief takes to show its tip, and to be picked. */
export interface HoverProps {
  onPointerEnter: (event: PointerEvent<SVGGElement>) => void;
  onPointerLeave: () => void;
  onClick?: () => void;
  className?: string;
}

interface Shown {
  tip: Tip;
  /** Where its anchor is in the frame, before the scene's zoom. */
  left: number;
  top: number;
  /** Too near the top of the frame: it hangs under the piece instead. */
  below: boolean;
}

export interface Hover {
  frame: RefObject<HTMLDivElement | null>;
  /** Where the tip floats, when not in the frame. */
  layer: HTMLElement | null;
  shown: Shown | null;
  /** The key of the piece under the pointer. */
  hovered: string | null;
  /** The props of a piece telling `tip`, picked by `pick` when it is pressed. */
  on: (tip: Tip, pick?: () => void) => HoverProps;
}

/** How long a tip waits before it goes, so that it slides to a neighbour. */
const LINGER_MS = 90;
/** Less room than this over a piece and its tip hangs under it. */
const ROOM = 120;

/** The pointer over the pieces of one relief, and where its tip stands. */
export function useHover(): Hover {
  const frame = useRef<HTMLDivElement | null>(null);
  const layer = useContext(TipLayer);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  const stay = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stay, [stay]);

  const on = useCallback(
    (tip: Tip, pick?: () => void): HoverProps => ({
      onPointerEnter: (event) => {
        stay();
        const box = layer ?? frame.current;
        if (box === null) {
          return;
        }
        const piece = event.currentTarget.getBoundingClientRect();
        const room = box.getBoundingClientRect();
        // The scene's zoom scales a frame: what the screen measures is
        // brought back to the box's own units.
        const scale = room.width === 0 ? 1 : box.offsetWidth / room.width;
        const top = (piece.top - room.top) * scale;
        const below = top < ROOM;
        setShown({
          tip,
          left: (piece.left + piece.width / 2 - room.left) * scale,
          top: below ? (piece.bottom - room.top) * scale : top,
          below,
        });
      },
      onPointerLeave: () => {
        stay();
        timer.current = setTimeout(() => {
          timer.current = null;
          setShown(null);
        }, LINGER_MS);
      },
      ...(pick === undefined
        ? {}
        : { onClick: pick, className: "cursor-pointer" }),
    }),
    [stay, layer],
  );

  return { frame, layer, shown, hovered: shown?.tip.key ?? null, on };
}

const SLIDE = { type: "spring", stiffness: 320, damping: 30 } as const;

interface ReliefFrameProps {
  hover: Hover;
  /** The relief's size and room, as the svg had them. */
  className?: string;
  children: ReactNode;
}

/**
 * Holds a relief and the glass tip that floats over the piece the pointer
 * rests on. The tip repeats what the relief's label already reads out, so it
 * is hidden from assistive technology and never takes the pointer.
 */
export function ReliefFrame({
  hover,
  className,
  children,
}: ReliefFrameProps): ReactNode {
  const reduced = useReducedMotionConfig() === true;
  const { shown } = hover;
  const tip = (
    <Presence>
      {shown !== null && (
        <motion.div
          key="tip"
          aria-hidden
          initial={{
            opacity: 0,
            scale: 0.96,
            left: shown.left,
            top: shown.top,
          }}
          animate={{ opacity: 1, scale: 1, left: shown.left, top: shown.top }}
          exit={{
            opacity: 0,
            scale: 0.98,
            transition: { duration: DURATION.exit, ease: EASE_OUT },
          }}
          transition={
            reduced
              ? { duration: 0 }
              : {
                  left: SLIDE,
                  top: SLIDE,
                  default: { duration: DURATION.enter, ease: EASE_OUT },
                }
          }
          className={cn(
            "pointer-events-none absolute z-20 w-max max-w-60 -translate-x-1/2 rounded-xl glass-float px-3.5 py-2.5",
            shown.below ? "mt-3" : "-mt-3 -translate-y-full",
          )}
        >
          <Presence swap>
            <Reveal
              key={shown.tip.key}
              kind="fade"
              index={0}
              className="flex flex-col gap-0.5"
            >
              <span className="text-sm font-semibold text-ink">
                {shown.tip.title}
              </span>
              <Presence>
                {shown.tip.lines.map((line) => (
                  <Reveal
                    key={line}
                    as="span"
                    kind="fade"
                    index={0}
                    className="text-xs text-ink-soft"
                  >
                    {line}
                  </Reveal>
                ))}
              </Presence>
            </Reveal>
          </Presence>
        </motion.div>
      )}
    </Presence>
  );
  return (
    <div ref={hover.frame} className={cn("relative", className)}>
      {children}
      {hover.layer === null ? tip : createPortal(tip, hover.layer)}
    </div>
  );
}
