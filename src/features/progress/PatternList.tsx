import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PatternState, PatternView } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/text";
import { STEPS, byWork, stepOf } from "./ladder";

const PILL: Record<PatternState, string> = {
  detected: "border-line bg-sunken text-ink-soft",
  focus: "border-transparent bg-mint text-on-cta",
  relapse: "border-wrong/30 bg-wrong-soft text-wrong",
  improving: "border-correct/30 bg-correct-soft text-correct",
  mastered: "border-correct/30 bg-correct-soft text-correct",
};

const SEGMENT: Record<PatternState, string> = {
  detected: "bg-ink-faint",
  focus: "bg-mint",
  relapse: "bg-wrong",
  improving: "bg-correct",
  mastered: "bg-correct",
};

/** What is being worked on now is alive: its pill breathes. */
const LIVE: ReadonlySet<PatternState> = new Set(["relapse", "focus"]);

interface PatternCardProps {
  pattern: PatternView;
  selected: boolean;
  onSelect: () => void;
}

/** One pattern as a glass card: where it stands, and how often it goes right. */
function PatternCard({
  pattern,
  selected,
  onSelect,
}: PatternCardProps): ReactNode {
  const { t, i18n } = useTranslation();
  const filled = stepOf(pattern.state) + 1;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group flex size-full flex-col gap-2.5 rounded-xl glass p-4 text-left transition-control hover:-translate-y-0.5 hover:shadow-lift",
        selected && "ring-1 ring-accent/50",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-base font-semibold text-ink">
          {pattern.description}
        </span>
        <ArrowUpRight
          aria-hidden
          className="size-3.5 shrink-0 text-ink-faint transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-text"
        />
      </span>
      <span className="font-mono text-xs text-ink-faint">
        {[
          t("progress.seen", { count: pattern.sessionsSeen }),
          pattern.nextReviewAt === null
            ? null
            : t("progress.nextReview", {
                date: formatDate(pattern.nextReviewAt, i18n.language),
              }),
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold",
          PILL[pattern.state],
        )}
      >
        <Presence>
          {LIVE.has(pattern.state) && (
            <Reveal
              key="live"
              as="span"
              kind="fade"
              aria-hidden
              className="flex"
            >
              <span className="size-1.5 animate-breathe rounded-full bg-current" />
            </Reveal>
          )}
        </Presence>
        {t(`patternState.${pattern.state}`)}
      </span>
      <span aria-hidden className="flex gap-0.5">
        {STEPS.map((step, at) => (
          <span
            key={step}
            className={cn(
              "h-2 flex-1 rounded-xs transition-colors duration-300",
              at < filled ? SEGMENT[pattern.state] : "bg-line-strong",
            )}
          />
        ))}
      </span>
      <span className="font-mono text-xs text-ink tabular-nums">
        {pattern.correctRate === null
          ? t("progress.rateNone")
          : t("progress.correctRate", {
              percent: Math.round(pattern.correctRate * 100),
            })}
      </span>
    </button>
  );
}

interface PatternListProps {
  patterns: PatternView[];
  /** The pattern shown over the staircase. */
  selected: string | null;
  onSelect: (id: string) => void;
}

/** Every pattern as a card, the active work first; a click shows it on the staircase. */
export function PatternList({
  patterns,
  selected,
  onSelect,
}: PatternListProps): ReactNode {
  return (
    <ul className="grid grid-cols-2 gap-3">
      <Presence>
        {byWork(patterns).map((pattern, index) => (
          <Reveal
            key={pattern.id}
            as="li"
            index={index}
            layout="position"
            className="min-w-0"
          >
            <PatternCard
              pattern={pattern}
              selected={pattern.id === selected}
              onSelect={() => {
                onSelect(pattern.id);
              }}
            />
          </Reveal>
        ))}
      </Presence>
    </ul>
  );
}
