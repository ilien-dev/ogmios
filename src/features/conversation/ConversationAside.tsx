import type { MotionValue } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Orb } from "@/components/ui/Orb";
import type { OrbState } from "@/components/ui/Orb";
import { useWideHome } from "@/features/home/homeLayout";
import { formatNumber } from "@/lib/text";

interface ConversationAsideProps {
  state: OrbState;
  /** What the orb is doing, in words: it is never the only way to know. */
  status: string;
  level: MotionValue<number> | undefined;
  minutes: number;
  target: number | null;
  /** The one line of encouragement for this turn, already in words. */
  mood: string;
  moodKey: string;
}

/**
 * The partner beside the chat: its orb, what it is doing, the minutes spoken
 * and a word to keep going. Under the `nav` width it is a strip above the chat.
 */
export function ConversationAside({
  state,
  status,
  level,
  minutes,
  target,
  mood,
  moodKey,
}: ConversationAsideProps): ReactNode {
  const { t, i18n } = useTranslation();
  const wide = useWideHome();
  const spoken = (n: number): string => formatNumber(n, i18n.language);

  return (
    <Reveal
      as="aside"
      index={1}
      className="flex shrink-0 items-center gap-4 nav:w-72 nav:flex-col nav:justify-center nav:gap-6 nav:text-center"
    >
      <Orb size={wide ? "xl" : "sm"} state={state} level={level} shared />
      <div className="flex min-w-0 flex-col gap-2 nav:items-center">
        <div className="relative min-h-7">
          <Presence swap>
            <Reveal
              key={status}
              as="p"
              kind="fade"
              index={0}
              aria-live="polite"
              className="text-lg font-semibold text-ink nav:text-xl"
            >
              {status}
            </Reveal>
          </Presence>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-soft tabular-nums">
          <p>
            <CountUp
              value={minutes}
              format={(n) =>
                target === null
                  ? t("conversation.speechNoTarget", { spoken: spoken(n) })
                  : t("conversation.speech", { spoken: spoken(n), target })
              }
            />
          </p>
          <Presence>
            {target !== null && (
              <Reveal
                key="target"
                as="span"
                kind="fade"
                aria-hidden
                className="h-1 w-20 overflow-hidden rounded-full bg-raised"
              >
                <span
                  className="block h-full origin-left rounded-full bg-you transition-transform duration-500 ease-out-expo"
                  style={{
                    transform: `scaleX(${Math.min(1, minutes / target)})`,
                  }}
                />
              </Reveal>
            )}
          </Presence>
        </div>
        <div className="relative min-h-10 max-w-60">
          <Presence swap>
            <Reveal
              key={moodKey}
              as="p"
              kind="fade"
              index={0}
              className="text-sm leading-relaxed text-ink-soft nav:text-center"
            >
              <Info
                aria-hidden
                className="mr-1.5 inline size-3.5 align-text-top"
              />
              {mood}
            </Reveal>
          </Presence>
        </div>
      </div>
    </Reveal>
  );
}
