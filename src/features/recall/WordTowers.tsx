import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Strength } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { ReliefFrame, useHover } from "@/components/scene/HoverTip";
import type { Box, Point } from "@/components/scene/iso";
import { project, topCentre } from "@/components/scene/iso";
import { Block, Floor } from "@/components/scene/Relief";
import { cn } from "@/lib/cn";
import { animated, EASE_OUT } from "@/lib/motion";
import { StrengthMark } from "./StrengthMark";
import { planTowers } from "./towers";

const STRENGTHS = ["new", "settling", "firm"] as const;

const WIDTH = 56;
const DEPTH = 56;
/** Between two towers: room for the card over each. */
const GAP = 120;
/** Around the towers, on the plinth. */
const MARGIN = 36;
const BASE = 8;
/** How tall the tallest tower stands, whatever its floors. */
const HEIGHT = 132;
/** The seam between two floors. */
const SEAM = 3;
/** The card that names a tower's words, in the units of the drawing. */
const CARD_W = 148;
const CARD_H = 108;
const CARD_GAP = 18;

interface WordTowersProps {
  /** How many words the review holds of each strength. */
  counts: Record<Strength, number>;
  /** The latest words of each strength, named beside its tower. */
  words: Record<Strength, readonly string[]>;
  /** Read out instead of the drawing. */
  label: string;
  className?: string;
}

/** Where a tower's card stands: over its top, its foot just above it. */
function cardAt([x, y]: Point): Point {
  return [x - CARD_W / 2, y - CARD_H - CARD_GAP];
}

/** How tall a floor stands: few floors stand tall, many stand thin. */
function floorHeight(floors: number): number {
  return Math.min(34, Math.max(10, HEIGHT / Math.max(1, floors) - SEAM));
}

/**
 * The learned words as towers on a plinth, seen in 3D: one per strength, a
 * floor for every few words, the firm one in teal. The floors rise one after
 * another, and beside each tower a card names its latest words.
 */
export function WordTowers({
  counts,
  words,
  label,
  className,
}: WordTowersProps): ReactNode {
  const { t } = useTranslation();
  const plan = planTowers(counts);
  const moving = animated();
  const hover = useHover();
  const length = STRENGTHS.length * WIDTH + (STRENGTHS.length - 1) * GAP;
  const plinth: Box = {
    x: 0,
    y: 0,
    w: length + MARGIN * 2,
    d: DEPTH + MARGIN * 2,
    h: BASE,
  };
  const slab = floorHeight(
    Math.max(plan.floors.new, plan.floors.settling, plan.floors.firm),
  );
  const towers = STRENGTHS.map((strength) => {
    const x = MARGIN + STRENGTHS.indexOf(strength) * (WIDTH + GAP);
    const slabs: Box[] = Array.from(
      { length: plan.floors[strength] },
      (_, floor) => ({
        x,
        y: MARGIN,
        w: WIDTH,
        d: DEPTH,
        h: slab,
        z: BASE + floor * (slab + SEAM),
      }),
    );
    const top = slabs.at(-1);
    const anchor =
      top === undefined
        ? project(x + WIDTH / 2, MARGIN + DEPTH / 2, BASE)
        : topCentre(top);
    return { strength, slabs, card: cardAt(anchor) };
  });

  const floor = Math.max(plinth.w, plinth.d) + 32;
  // The plinth and the cards frame the drawing; the floor runs on past it.
  const corners: Point[] = [
    project(0, 0),
    project(plinth.w, 0),
    project(plinth.w, plinth.d),
    project(0, plinth.d),
    ...towers.flatMap(({ card: [x, y] }): Point[] => [
      [x, y],
      [x + CARD_W, y + CARD_H],
    ]),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const left = Math.min(...xs) - 16;
  const high = Math.min(...ys) - 16;
  const width = Math.max(...xs) + 16 - left;
  const height = Math.max(...ys) + 16 - high;

  return (
    <ReliefFrame hover={hover} className={className}>
      <svg
        viewBox={`${String(left)} ${String(high)} ${String(width)} ${String(height)}`}
        role="img"
        aria-label={label}
        className="block size-full"
      >
        <Floor size={floor} step={16} />
        <Block {...plinth} />
        {towers.map(({ strength, slabs }, at) => {
          const tip = hover.on({
            key: strength,
            title: t(`recall.strength.${strength}`),
            lines: [t("scene.tip.words", { count: counts[strength] })],
          });
          return (
            <g key={strength}>
              <Presence>
                {slabs.map((storey, floorAt) => (
                  <motion.g
                    key={storey.z}
                    initial={moving ? { opacity: 0, y: 16 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{
                      duration: 0.5,
                      ease: EASE_OUT,
                      delay: at * 0.1 + floorAt * 0.035,
                    }}
                  >
                    <Block
                      {...storey}
                      look={strength === "firm" ? "book" : "plain"}
                      raised={hover.hovered === strength}
                      hover={tip}
                    />
                  </motion.g>
                ))}
              </Presence>
            </g>
          );
        })}
        {towers.map(({ strength, card: [x, y] }, at) => {
          const named = words[strength];
          const rest = counts[strength] - named.length;
          return (
            <motion.foreignObject
              key={`card-${strength}`}
              x={x}
              y={y}
              width={CARD_W}
              height={CARD_H}
              initial={moving ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{
                duration: 0.5,
                ease: EASE_OUT,
                delay: 0.4 + at * 0.1,
              }}
            >
              <div className="flex h-full flex-col justify-end">
                <div
                  className={cn(
                    "flex flex-col gap-1 rounded-xl px-3 py-2.5",
                    strength === "firm"
                      ? "border border-book/35 bg-book-soft/90"
                      : "glass",
                  )}
                >
                  <p className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
                    {t(`recall.count.${strength}`, { count: counts[strength] })}
                    <StrengthMark strength={strength} />
                  </p>
                  <Presence>
                    {named.length > 0 && (
                      <Reveal
                        key="words"
                        as="p"
                        kind="fade"
                        className="line-clamp-2 text-xs leading-relaxed text-ink-soft"
                      >
                        {named.join(" · ")}
                      </Reveal>
                    )}
                  </Presence>
                  <Presence>
                    {rest > 0 && named.length > 0 && (
                      <Reveal
                        key="more"
                        as="p"
                        kind="fade"
                        className="font-mono text-xs text-ink-faint"
                      >
                        {t("recall.towers.more", { count: rest })}
                      </Reveal>
                    )}
                  </Presence>
                </div>
              </div>
            </motion.foreignObject>
          );
        })}
      </svg>
    </ReliefFrame>
  );
}
