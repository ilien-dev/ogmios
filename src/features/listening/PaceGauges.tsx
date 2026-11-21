import { motion, useReducedMotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PaceStanding } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, animated } from "@/lib/motion";
import { heardShare } from "./paceGauge";

/** The ring's radius in its 88-unit box, and how long it runs round. */
const RADIUS = 36;
const ROUND = 2 * Math.PI * RADIUS;

/**
 * One pace as a ring, as full as what was heard at it. The ring of a pace
 * never tried stays, emptied, so that its first sentence fills it in.
 */
function Gauge({
  standing,
  index,
}: {
  standing: PaceStanding;
  index: number;
}): ReactNode {
  const { t } = useTranslation();
  const reduced = useReducedMotionConfig() === true;
  const name = t(`listening.pace.${standing.pace}`);
  const share = heardShare(standing);
  const gap = ROUND * (1 - (share ?? 0) / 100);
  return (
    <Reveal
      as="li"
      index={index}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl glass px-3 py-4 text-center @max-md:flex-row @max-md:gap-4 @max-md:px-4 @max-md:py-3 @max-md:text-left",
        standing.held && "border-accent/40",
      )}
    >
      <svg
        viewBox="0 0 88 88"
        role="img"
        aria-label={t("listening.standing.bar", { pace: name })}
        className="size-22 shrink-0 @max-md:size-14"
      >
        <circle
          cx="44"
          cy="44"
          r={RADIUS}
          fill="none"
          strokeWidth="7"
          strokeDasharray={share === null ? "4 6" : undefined}
          className="stroke-raised"
        />
        <motion.circle
          cx="44"
          cy="44"
          r={RADIUS}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={ROUND}
          transform="rotate(-90 44 44)"
          initial={
            animated() && !reduced
              ? { strokeDashoffset: ROUND, opacity: 0 }
              : false
          }
          animate={{ strokeDashoffset: gap, opacity: share === null ? 0 : 1 }}
          transition={{ duration: DURATION.enterSlow, ease: EASE_OUT }}
          className={standing.held ? "stroke-accent" : "stroke-book"}
        />
        <text
          x="44"
          y="51"
          textAnchor="middle"
          className="fill-ink font-display text-xl font-light"
        >
          {share ?? "–"}
        </text>
      </svg>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display font-medium tracking-tight text-ink">
          {name}
        </span>
        <Presence swap>
          {standing.held ? (
            <Reveal
              key="held"
              as="span"
              kind="fade"
              className="text-xs text-accent-text"
            >
              {t("listening.standing.held")}
            </Reveal>
          ) : (
            <Reveal
              key="count"
              as="span"
              kind="fade"
              className="font-mono text-xs text-ink-faint tabular-nums"
            >
              {share === null
                ? t("listening.standing.none")
                : t("listening.standing.count", {
                    count: standing.sentences,
                    percent: share,
                  })}
            </Reveal>
          )}
        </Presence>
      </span>
    </Reveal>
  );
}

/**
 * The three paces as rings, slowest first: how much the learner heard at
 * each, and which are theirs. Side by side; one under the other when the tab
 * is narrow.
 */
export function PaceGauges({
  standings,
}: {
  standings: readonly PaceStanding[];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("listening.standing.title")}
      className="grid grid-cols-3 gap-3 @max-md:grid-cols-1"
    >
      {standings.map((standing, index) => (
        <Gauge key={standing.pace} standing={standing} index={index} />
      ))}
    </ul>
  );
}
