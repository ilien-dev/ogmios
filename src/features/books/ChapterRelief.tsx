import { motion, useReducedMotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Chapter } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import type { Box } from "@/components/scene/iso";
import { byDepth, project, topCentre } from "@/components/scene/iso";
import { ReliefFrame, useHover } from "@/components/scene/HoverTip";
import { Block, Floor, Pin } from "@/components/scene/Relief";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, animated } from "@/lib/motion";
import { barState } from "./chapterChart";
import { chapterName } from "./chapterName";

/** The side of a chapter's block, and the room from one to the next. */
const SIDE = 60;
const STEP = 84;
/** How tall a chapter stands when every word is done, and when none is taken out. */
const TALL = 110;
const FLAT = 5;

interface Placed extends Box {
  chapter: Chapter;
  /** Its place in the cascade, in reading order. */
  order: number;
}

/** How tall a chapter's block stands: its readiness, or flat before it is prepared. */
function height(chapter: Chapter): number {
  return chapter.readiness === null
    ? FLAT
    : FLAT + 6 + Math.round((chapter.readiness / 100) * (TALL - FLAT - 6));
}

/** The chapters laid on a square grid, in reading order from the back. */
function place(chapters: readonly Chapter[]): {
  boxes: Placed[];
  size: number;
} {
  const cols = Math.max(1, Math.ceil(Math.sqrt(chapters.length)));
  const rows = Math.max(1, Math.ceil(chapters.length / cols));
  const boxes = chapters.map((chapter, order) => ({
    chapter,
    order,
    x: (order % cols) * STEP,
    y: Math.floor(order / cols) * STEP,
    w: SIDE,
    d: SIDE,
    h: height(chapter),
  }));
  return { boxes, size: Math.max(cols, rows) * STEP };
}

const NUMBER: Record<"plain" | "lit" | "book", string> = {
  plain: "fill-ink-soft",
  lit: "fill-on-cta",
  book: "fill-canvas",
};

interface ChapterReliefProps {
  chapters: readonly Chapter[];
  selectedId: string;
  /** Picks a chapter, as its bar in the chart does. */
  onSelect?: (chapterId: string) => void;
  /** Read out instead of the drawing. */
  label: string;
  className?: string;
}

/** How the glow and the pin follow the picked block. */
const FOLLOW = { type: "spring", stiffness: 140, damping: 22 } as const;

/**
 * The book's chapters raised as blocks: the more of a chapter's words are
 * ready, the taller it stands; a ready one in the book's colour, the picked
 * one lit in mint with a pin over it. They rise one after another, grow as
 * their words get ready, and tell their chapter under the pointer.
 */
export function ChapterRelief({
  chapters,
  selectedId,
  onSelect,
  label,
  className,
}: ChapterReliefProps): ReactNode {
  const { t } = useTranslation();
  const hover = useHover();
  const reduced = useReducedMotionConfig() === true;
  const rise = animated() && !reduced;
  const { boxes, size } = place(chapters);
  const [left] = project(0, size);
  const [right] = project(size, 0);
  const [, top] = project(0, 0, TALL);
  const [, bottom] = project(size, size);
  const picked = boxes.find((box) => box.chapter.id === selectedId);
  const glow =
    picked === undefined
      ? null
      : project(picked.x + SIDE / 2, picked.y + SIDE / 2);
  return (
    <ReliefFrame hover={hover} className={className}>
      <svg
        viewBox={`${left - 40} ${top - 70} ${right - left + 80} ${bottom - top + 110}`}
        role="img"
        aria-label={label}
        className="block size-full"
      >
        <Floor size={size} step={STEP / 2} />
        <Presence>
          {glow !== null && (
            <motion.g
              key="glow"
              initial={rise ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: DURATION.exit, ease: EASE_OUT },
              }}
            >
              <motion.ellipse
                initial={false}
                animate={{ cx: glow[0], cy: glow[1] }}
                transition={reduced ? { duration: 0 } : FOLLOW}
                rx={64}
                ry={32}
                className="animate-breathe fill-mint transform-fill"
                fillOpacity={0.16}
              />
            </motion.g>
          )}
        </Presence>
        {byDepth(boxes).map((box) => {
          const on = box.chapter.id === selectedId;
          const state = barState(box.chapter);
          const look = on ? "lit" : state === "ready" ? "book" : "plain";
          const tip = {
            key: box.chapter.id,
            title: chapterName(box.chapter, t),
            lines: [
              t(`bookHome.state.${state}`, {
                readiness: box.chapter.readiness ?? 0,
              }),
              t("bookHome.board.length", { count: box.chapter.words }),
            ],
          };
          return (
            <motion.g
              key={box.chapter.id}
              initial={rise ? { opacity: 0, y: 36 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                ease: EASE_OUT,
                delay: 0.15 + box.order * 0.06,
              }}
            >
              <Block
                {...box}
                look={look}
                raised={hover.hovered === box.chapter.id}
                hover={hover.on(
                  tip,
                  onSelect === undefined
                    ? undefined
                    : () => {
                        onSelect(box.chapter.id);
                      },
                )}
              >
                <text
                  y={4}
                  textAnchor="middle"
                  aria-hidden
                  className={cn(
                    "pointer-events-none font-mono text-xs transition-control",
                    NUMBER[look],
                  )}
                >
                  {box.chapter.index + 1}
                </text>
              </Block>
            </motion.g>
          );
        })}
        <Presence>
          {picked !== undefined && (
            <motion.g
              key="pin"
              className="pointer-events-none"
              initial={rise ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: DURATION.exit, ease: EASE_OUT },
              }}
              transition={{
                duration: 0.5,
                ease: EASE_OUT,
                delay: 0.4 + boxes.length * 0.06,
              }}
            >
              <Pin
                at={topCentre(picked)}
                tone="focus"
                rise={58}
                raised={hover.hovered === picked.chapter.id}
              />
            </motion.g>
          )}
        </Presence>
      </svg>
    </ReliefFrame>
  );
}
