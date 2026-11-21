import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Info, SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Level, SessionSetup } from "@shared/domain";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { StatChip } from "@/components/scene/Stats";
import { cn } from "@/lib/cn";
import { EASE_OUT } from "@/lib/motion";
import { formatNumber } from "@/lib/text";
import { HelpCard } from "./HelpCard";
import { PartnerCard } from "./PartnerCard";
import type { PartnerState } from "./PartnerCard";

const LEVEL_ICON: Record<Level, LucideIcon> = {
  basic: SignalLow,
  intermediate: SignalMedium,
  advanced: SignalHigh,
};

/** The segments of the words bar. */
const SEGMENTS = 10;

function WordsTile({
  words,
  goal,
  hint,
}: {
  words: number;
  goal: number;
  hint: string;
}): ReactNode {
  const { t } = useTranslation();
  const lit = Math.round(Math.min(1, words / Math.max(1, goal)) * SEGMENTS);
  return (
    <div className="flex flex-col gap-4 rounded-xl glass px-5 py-4.5">
      <span className="text-base text-ink">{t("conversation.meterLabel")}</span>
      <span className="flex items-baseline gap-1.5" aria-hidden>
        <CountUp
          value={words}
          className="font-display text-5xl leading-none font-light tracking-tight text-ink tabular-nums"
        />
        <span className="font-display text-xl font-light text-ink-faint">
          / {goal}
        </span>
      </span>
      <span aria-hidden className="flex gap-1">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2 flex-1 rounded-sm transition-colors duration-300 ease-out-expo",
              i < lit ? "bg-mint" : "bg-line-strong",
            )}
          />
        ))}
      </span>
      <div className="relative min-h-5">
        <Presence swap>
          {hint !== "" && (
            <Reveal
              key={hint}
              as="p"
              kind="fade"
              index={0}
              className="text-sm text-ink-faint"
            >
              {hint}
            </Reveal>
          )}
        </Presence>
      </div>
    </div>
  );
}

const RADIUS = 40;

function MinutesTile({
  minutes,
  target,
}: {
  minutes: number;
  target: number | null;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const spoken = (n: number): string => formatNumber(n, i18n.language);
  const share = target === null ? 0 : Math.min(1, minutes / target);
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl glass px-5 py-4.5">
      <span className="text-base text-ink">{t("conversation.minutes")}</span>
      <span className="relative grid size-24 place-items-center">
        <svg viewBox="0 0 96 96" aria-hidden className="absolute inset-0">
          <circle
            cx={48}
            cy={48}
            r={RADIUS}
            fill="none"
            strokeWidth={8}
            className="stroke-line-strong"
          />
          <motion.circle
            cx={48}
            cy={48}
            r={RADIUS}
            fill="none"
            strokeWidth={8}
            strokeLinecap="round"
            transform="rotate(-90 48 48)"
            className="stroke-mint"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: share, opacity: share > 0 ? 1 : 0 }}
            transition={{ duration: 0.9, ease: EASE_OUT }}
          />
        </svg>
        <CountUp
          value={minutes}
          from={0}
          format={spoken}
          className="relative font-display text-2xl font-light text-ink tabular-nums"
        />
      </span>
      <p className="text-sm text-ink-faint">
        <CountUp
          value={minutes}
          format={(n) =>
            target === null
              ? t("conversation.speechNoTarget", { spoken: spoken(n) })
              : t("conversation.speech", { spoken: spoken(n), target })
          }
        />
      </p>
    </div>
  );
}

interface ConversationAsideProps {
  setup: SessionSetup;
  sessionId: string | null;
  partner: PartnerState;
  /** What the partner is doing, in words. */
  status: string;
  /** Whether the partner's voice is being read aloud. */
  speaking: boolean;
  words: number;
  goal: number;
  lengthHint: string;
  minutes: number;
  /** The one line of encouragement for this turn, already in words. */
  mood: string;
  moodKey: string;
  /** Drops English from "How do I say…?" into the answer. */
  onInsert: (english: string) => void;
}

/**
 * The column of glass beside the chat, as in the proposal: what this talk
 * is, the words of this turn, the minutes spoken, the partner and its voice,
 * the promise that nothing is corrected now, and "How do I say…?".
 */
export function ConversationAside({
  setup,
  sessionId,
  partner,
  status,
  speaking,
  words,
  goal,
  lengthHint,
  minutes,
  mood,
  moodKey,
  onInsert,
}: ConversationAsideProps): ReactNode {
  const { t } = useTranslation();
  const LevelIcon = LEVEL_ICON[setup.level];
  return (
    <Stagger className="flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md wide:overflow-y-auto wide:pb-2">
      <Reveal as="header" kind="fade" className="flex flex-wrap gap-2">
        <StatChip>{t(`mode.${setup.mode}`)}</StatChip>
        <StatChip>{t(`personality.${setup.personality}`)}</StatChip>
        <StatChip
          value={<LevelIcon aria-hidden className="size-4 text-accent-text" />}
        >
          {t(`level.${setup.level}`)}
        </StatChip>
      </Reveal>
      <Reveal className="grid grid-cols-2 gap-3">
        <WordsTile words={words} goal={goal} hint={lengthHint} />
        <MinutesTile minutes={minutes} target={setup.targetMinutes} />
      </Reveal>
      <Reveal>
        <PartnerCard
          state={partner}
          status={status}
          personality={t(`personality.${setup.personality}`)}
          speaking={speaking}
        />
      </Reveal>
      <Reveal className="flex items-start gap-3 rounded-xl glass px-4.5 py-4">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-text" />
        <div className="relative flex min-w-0 flex-1 flex-col gap-1">
          <div className="relative min-h-6">
            <Presence swap>
              <Reveal
                key={moodKey}
                as="p"
                kind="fade"
                index={0}
                className="text-base font-semibold text-ink"
              >
                {mood}
              </Reveal>
            </Presence>
          </div>
          <span className="text-sm text-ink-faint">
            {t("conversation.quiet")}
          </span>
        </div>
      </Reveal>
      <Reveal>
        <HelpCard sessionId={sessionId} onInsert={onInsert} />
      </Reveal>
    </Stagger>
  );
}
