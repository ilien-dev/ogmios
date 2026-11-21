import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PatternView } from "@shared/domain";
import type { Box } from "@/components/scene/iso";
import { faces, project } from "@/components/scene/iso";
import { Presence } from "@/components/motion/Presence";
import { ReliefFrame, useHover } from "@/components/scene/HoverTip";
import { Block, Floor, Pin } from "@/components/scene/Relief";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, animated } from "@/lib/motion";
import { STEPS, TONE, stepOf } from "./ladder";

/** The steps in plan units: each one further along and higher. */
const STEP_W = 130;
const STEP_D = 230;
const STEP_GAP = 10;
const BOXES: readonly Box[] = STEPS.map((_, at) => ({
  x: at * (STEP_W + STEP_GAP),
  y: 0,
  w: STEP_W,
  d: STEP_D,
  h: 22 + at * 38,
}));

/** At most this many pins stand on one step. */
const PINS_PER_STEP = 5;
/** At most this many patterns a step's tip names. */
const NAMED = 2;

const LABEL = [
  "fill-ink-soft",
  "fill-accent-text",
  "fill-correct",
  "fill-correct",
] as const;

/** Where the pins of one step stand, spread along its depth. */
function spots(box: Box, count: number): Array<readonly [number, number]> {
  return Array.from({ length: count }, (_, at) =>
    project(
      box.x + box.w / 2,
      box.y + (box.d * (at + 1)) / (count + 1),
      (box.z ?? 0) + box.h,
    ),
  );
}

interface StaircaseProps {
  patterns: readonly PatternView[];
  /** The pattern shown in the card over the scene, marked on its step. */
  selected: string | null;
  className?: string;
}

/**
 * The four states of a pattern raised as a staircase, from noticed to
 * mastered, with a pin for each pattern on the step it stands on. It builds
 * itself step by step as it arrives; the focus step glows. A step or a pin
 * tells what stands there under the pointer.
 */
export function Staircase({
  patterns,
  selected,
  className,
}: StaircaseProps): ReactNode {
  const { t } = useTranslation();
  const hover = useHover();
  const moving = animated();
  const onStep = STEPS.map((_, at) =>
    patterns.filter((pattern) => stepOf(pattern.state) === at),
  );
  const [left] = project(0, STEP_D);
  const last = BOXES.at(-1) ?? BOXES[0];
  const [right] = project((last?.x ?? 0) + STEP_W, 0);
  const [, top] = project(0, 0, (BOXES[0]?.h ?? 0) + 80);
  const [, bottom] = project((last?.x ?? 0) + STEP_W, STEP_D);
  const [glowX, glowY] = project(
    (BOXES[1]?.x ?? 0) + STEP_W / 2,
    STEP_D / 2,
    BOXES[1]?.h ?? 0,
  );

  return (
    <ReliefFrame hover={hover} className={className}>
      <svg
        viewBox={`${left - 30} ${top - 20} ${right - left + 60} ${bottom - top + 50}`}
        role="img"
        aria-label={t("progress.staircase", {
          detected: onStep[0]?.length ?? 0,
          focus: onStep[1]?.length ?? 0,
          improving: onStep[2]?.length ?? 0,
          mastered: onStep[3]?.length ?? 0,
        })}
        className="block size-full"
      >
        <Floor size={600} step={40} />
        {BOXES.map((box, at) => {
          const state = STEPS[at] ?? "detected";
          const { top: face } = faces(box);
          const [lx, ly] = project(box.x + 12, box.y + box.d, box.h / 2 - 5);
          const standing = onStep[at] ?? [];
          const named = standing
            .slice(0, NAMED)
            .map((each) => each.description);
          const tip = {
            key: state,
            title: t(`patternState.${state}`),
            lines: [
              t("scene.tip.patterns", { count: standing.length }),
              ...named,
              ...(standing.length > NAMED
                ? [t("scene.tip.more", { count: standing.length - NAMED })]
                : []),
            ],
          };
          return (
            <motion.g
              key={state}
              initial={moving ? { opacity: 0, y: 36 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.6,
                ease: EASE_OUT,
                delay: 0.1 + at * 0.16,
              }}
            >
              <Block
                {...box}
                look={state === "focus" ? "lit" : "plain"}
                raised={hover.hovered === state}
                hover={hover.on(tip)}
                decor={
                  <>
                    <Presence>
                      {at >= 2 && (
                        <motion.polygon
                          key="done"
                          points={face}
                          className="fill-correct"
                          fillOpacity={at === 3 ? 0.3 : 0.18}
                          initial={moving ? { opacity: 0 } : false}
                          animate={{ opacity: 1 }}
                          exit={{
                            opacity: 0,
                            transition: {
                              duration: DURATION.exit,
                              ease: EASE_OUT,
                            },
                          }}
                        />
                      )}
                    </Presence>
                    <text
                      x={lx}
                      y={ly}
                      transform={`rotate(30 ${lx} ${ly})`}
                      className={cn(
                        LABEL[at],
                        "font-mono text-xs tracking-wider uppercase",
                      )}
                    >
                      {t(`patternState.${state}`)}
                    </text>
                  </>
                }
              />
            </motion.g>
          );
        })}
        <motion.ellipse
          cx={glowX}
          cy={glowY}
          rx={64}
          ry={34}
          className="pointer-events-none animate-breathe fill-mint transform-fill"
          initial={moving ? { opacity: 0 } : false}
          animate={{ opacity: 0.22 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        />
        <Presence>
          {onStep.map((list, at) => {
            const box = BOXES[at];
            if (box === undefined) {
              return null;
            }
            const shown = list.slice(0, PINS_PER_STEP);
            const where = spots(box, shown.length);
            return shown.map((pattern, index) => {
              const spot = where[index] ?? project(0, 0);
              const [px, py] = spot;
              return (
                <motion.g
                  key={pattern.id}
                  initial={moving ? { opacity: 0, y: -18 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -18, transition: { duration: 0.2 } }}
                  transition={{
                    duration: 0.5,
                    ease: EASE_OUT,
                    delay: 0.45 + at * 0.16 + index * 0.06,
                  }}
                >
                  <Presence>
                    {pattern.id === selected && (
                      <motion.g
                        key="selected"
                        initial={moving ? { opacity: 0 } : false}
                        animate={{ opacity: 1 }}
                        exit={{
                          opacity: 0,
                          transition: {
                            duration: DURATION.exit,
                            ease: EASE_OUT,
                          },
                        }}
                      >
                        <ellipse
                          cx={px}
                          cy={py}
                          rx={26}
                          ry={12}
                          className="pointer-events-none animate-breathe fill-mint transform-fill"
                          fillOpacity={0.35}
                        />
                      </motion.g>
                    )}
                  </Presence>
                  <Pin
                    at={spot}
                    tone={TONE[pattern.state]}
                    rise={pattern.id === selected ? 68 : 52}
                    raised={hover.hovered === pattern.id}
                    hover={hover.on({
                      key: pattern.id,
                      title: pattern.description,
                      lines: [t(`patternState.${pattern.state}`)],
                    })}
                  />
                </motion.g>
              );
            });
          })}
        </Presence>
      </svg>
    </ReliefFrame>
  );
}
