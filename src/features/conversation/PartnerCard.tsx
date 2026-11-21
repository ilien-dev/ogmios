import { motion, useReducedMotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import { animated } from "@/lib/motion";

/** What the partner is doing, as the card shows it. */
export type PartnerState = "live" | "thinking" | "listening";

/** The bars of the drawing, in viewBox units: a voice, not a recording. */
const BARS = [
  14, 30, 50, 26, 66, 38, 18, 54, 34, 10, 22, 46, 60, 28, 40, 16, 52, 36, 24,
  58, 32, 12, 44, 62, 20, 48, 30, 56, 26, 14,
] as const;
const STEP = 12;
const MIDDLE = 48;

/**
 * A voice drawn as a wave: it moves while the partner writes or speaks, and
 * lies flat while it listens or waits. It stands for the voice; it is not one.
 */
function VoiceBars({ active }: { active: boolean }): ReactNode {
  const { t } = useTranslation();
  const reduced = useReducedMotionConfig();
  const loops = active && animated() && reduced !== true;
  return (
    <svg
      viewBox={`0 0 ${String(BARS.length * STEP + 8)} 96`}
      role="img"
      aria-label={t("conversation.voice")}
      className="h-24 w-full"
    >
      {BARS.map((height, i) => (
        <motion.rect
          key={`${String(i)}-${String(height)}`}
          x={8 + i * STEP}
          y={MIDDLE - height / 2}
          width={4}
          height={height}
          rx={2}
          className={cn(
            "origin-center transition-colors duration-500 transform-fill",
            active ? "fill-ink-soft" : "fill-ink-faint/40",
          )}
          initial={false}
          animate={
            loops
              ? { scaleY: [1, 0.35 + (i % 4) * 0.12, 1] }
              : { scaleY: active ? 1 : 0.12 }
          }
          transition={
            loops
              ? {
                  duration: 1 + (i % 5) * 0.14,
                  delay: i * 0.03,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
              : { duration: 0.5 }
          }
        />
      ))}
    </svg>
  );
}

const PILL: Record<PartnerState, string> = {
  live: "border-partner-line bg-partner-soft text-partner",
  thinking: "border-partner-line bg-partner-soft text-partner",
  listening: "border-accent/35 bg-accent-soft text-accent-text",
};

interface PartnerCardProps {
  state: PartnerState;
  /** What it is doing, in words: the drawing is never the only way to know. */
  status: string;
  personality: string;
  /** Whether its voice is being read aloud right now. */
  speaking: boolean;
}

/** The partner, as a card: its name, its manner, what it is doing, its voice. */
export function PartnerCard({
  state,
  status,
  personality,
  speaking,
}: PartnerCardProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-xl glass bg-linear-160 from-raised/70 to-transparent p-4.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-lg font-semibold text-ink">
            {t("conversation.partner")} · {t("conversation.ai")}
          </span>
          <span className="truncate font-mono text-xs text-ink-faint">
            {personality}
          </span>
        </div>
        <div className="relative shrink-0">
          <Presence swap>
            <Reveal
              key={status}
              as="p"
              kind="fade"
              index={0}
              aria-live="polite"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                PILL[state],
              )}
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 animate-breathe rounded-full bg-current"
              />
              {status}
            </Reveal>
          </Presence>
        </div>
      </div>
      <VoiceBars active={state === "thinking" || speaking} />
    </div>
  );
}
