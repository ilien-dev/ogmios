import { ArrowUpRight, CircleCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { SessionMetrics } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { MetricCard } from "@/components/scene/MetricCard";
import { BigNumber, StatChip, StatTile } from "@/components/scene/Stats";
import { TargetChart } from "@/components/scene/TargetChart";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/text";
import type { Step } from "./steps";
import { TONE_TAG, stepTag, stepTitle, stepTone } from "./stepMeta";
import { trend } from "./trend";

type MetricsStep = Extract<Step, { kind: "metrics" }>;

/** The few words a step's small card shows of what is inside it. */
function Preview({
  step,
  t,
  locale,
}: {
  step: Step;
  t: TFunction;
  locale: string;
}): ReactNode {
  const quiet = "line-clamp-2 text-sm leading-snug text-ink-soft";
  switch (step.kind) {
    case "achievement":
      return (
        <span className={quiet}>
          {step.card.bestSentence === null
            ? step.card.strengths[0]
            : `“${step.card.bestSentence}”`}
        </span>
      );
    case "focus":
    case "minors": {
      const cards = step.kind === "focus" ? [step.card] : step.cards;
      return (
        <span className={cn(quiet, "flex flex-wrap gap-x-2")}>
          {cards.map((card) => (
            <span
              key={card.itemId}
              className="text-ink-faint line-through decoration-wrong"
            >
              {card.highlight}
            </span>
          ))}
        </span>
      );
    }
    case "couldHaveSaid":
      return <span className={quiet}>{step.card.items[0]?.better}</span>;
    case "nativeRewrite":
      return <span className={quiet}>{step.rewrite.rewrite}</span>;
    case "vocabulary":
      return (
        <span className={quiet}>
          {step.card.items.map((item) => item.english).join(", ")}
        </span>
      );
    case "metrics":
      return (
        <span className={cn(quiet, "font-mono")}>
          {t("report.board.minutes", {
            minutes: formatNumber(step.card.current.speechMinutes, locale, 1),
          })}
        </span>
      );
    case "challenge":
      return <span className={quiet}>{step.card.text}</span>;
    default:
      return null;
  }
}

interface StepCardProps {
  step: Step;
  at: number;
  total: number;
  current: boolean;
  onPick: () => void;
}

/** A small glass card for one step of the report; a click goes to it. */
function StepCard({
  step,
  at,
  total,
  current,
  onPick,
}: StepCardProps): ReactNode {
  const { t, i18n } = useTranslation();
  return (
    <button
      type="button"
      aria-current={current ? "step" : undefined}
      onClick={onPick}
      className={cn(
        "group flex cursor-pointer flex-col gap-2.5 rounded-xl glass p-4 text-left transition-control hover:-translate-y-0.5 hover:shadow-lift",
        current &&
          "outline-1 outline-accent/50 focus-visible:outline-2 focus-visible:outline-accent-strong",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-base font-semibold tracking-tight text-ink">
          {stepTitle(step, t)}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-ink-faint">
          {at + 1}/{total}
          <ArrowUpRight
            aria-hidden
            className="size-3.5 transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-text"
          />
        </span>
      </span>
      <span
        className={cn(
          "self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold",
          TONE_TAG[stepTone(step)],
        )}
      >
        {stepTag(step, t)}
      </span>
      <Preview step={step} t={t} locale={i18n.language} />
    </button>
  );
}

interface SlipsProps {
  current: SessionMetrics;
  previous: SessionMetrics | null;
  onOpen: () => void;
}

/** Slips per 100 words, big and thin, against the mean of the last sessions. */
function Slips({ current, previous, onOpen }: SlipsProps): ReactNode {
  const { t, i18n } = useTranslation();
  const show = (n: number): string => formatNumber(n, i18n.language, 1);
  const now = current.errorsPer100;
  const before = previous?.errorsPer100 ?? null;
  const { delta, flat, better } = trend(now, before, 1, false);
  const modality = t(`modality.${current.modality}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="cursor-pointer rounded-xl text-left transition-control hover:-translate-y-0.5 hover:shadow-lift"
    >
      <MetricCard
        title={t("report.metrics.errorsPer100")}
        number={
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <BigNumber value={now} format={show} />
            <Presence>
              {before !== null && (
                <Reveal
                  key="trend"
                  as="span"
                  kind="fade"
                  className={cn(
                    "font-mono text-sm",
                    better === null
                      ? "text-ink-faint"
                      : better
                        ? "text-correct"
                        : "text-partial",
                  )}
                >
                  {flat
                    ? t("report.metrics.same")
                    : t(
                        delta > 0 ? "report.metrics.up" : "report.metrics.down",
                        {
                          previous: show(before),
                        },
                      )}
                </Reveal>
              )}
            </Presence>
          </span>
        }
        note={
          before === null
            ? t("report.metrics.baseline", { modality })
            : t("report.metrics.against", { modality })
        }
      >
        <Presence>
          {before !== null && (
            <Reveal key="chart" kind="fade">
              <TargetChart
                values={[before, now]}
                max={Math.max(before, now) * 1.4}
                labels={[t("report.board.before"), t("report.board.today")]}
                label={t("report.board.chart", {
                  before: show(before),
                  today: show(now),
                })}
              />
            </Reveal>
          )}
        </Presence>
      </MetricCard>
    </button>
  );
}

interface ReportBoardProps {
  steps: readonly Step[];
  index: number;
  onPick: (at: number) => void;
}

/**
 * The column of glass beside the scene: what this report holds, slips against
 * the last sessions, and a small card per step that goes to it.
 */
export function ReportBoard({
  steps,
  index,
  onPick,
}: ReportBoardProps): ReactNode {
  const { t } = useTranslation();
  const focus = steps.filter((step) => step.kind === "focus").length;
  const minors = steps.reduce(
    (sum, step) => sum + (step.kind === "minors" ? step.cards.length : 0),
    0,
  );
  const words = steps.reduce(
    (sum, step) =>
      sum + (step.kind === "vocabulary" ? step.card.items.length : 0),
    0,
  );
  const strengths = steps.reduce(
    (sum, step) =>
      sum + (step.kind === "achievement" ? step.card.strengths.length : 0),
    0,
  );
  const metricsAt = steps.findIndex((step) => step.kind === "metrics");
  const metrics = steps[metricsAt] as MetricsStep | undefined;

  return (
    <Stagger className="flex flex-col gap-3.5">
      <Reveal className="flex flex-wrap gap-2">
        <StatChip value={focus} tone="accent">
          {t("report.board.focus", { count: focus })}
        </StatChip>
        <StatChip value={minors}>
          {t("report.board.minor", { count: minors })}
        </StatChip>
        <StatChip value={words}>
          {t("report.board.words", { count: words })}
        </StatChip>
      </Reveal>
      <Reveal className="grid grid-cols-2 gap-3">
        <StatTile
          icon={<CircleCheck aria-hidden className="size-6 text-correct" />}
          label={t("report.board.wentWell")}
          value={strengths}
        />
        <StatTile
          icon={<TriangleAlert aria-hidden className="size-6 text-wrong" />}
          label={t("report.board.toFix")}
          value={focus + minors}
        />
      </Reveal>
      <Presence>
        {metrics !== undefined && (
          <Reveal key="metrics">
            <Slips
              current={metrics.card.current}
              previous={metrics.card.previous}
              onOpen={() => {
                onPick(metricsAt);
              }}
            />
          </Reveal>
        )}
      </Presence>
      <Reveal
        as="nav"
        aria-label={t("report.board.cards")}
        className="grid grid-cols-2 gap-3"
      >
        {/* The closing card holds no data; Next still reaches it. */}
        {steps.map((step, at) =>
          step.kind === "closing" ? null : (
            <StepCard
              key={`${step.kind}-${at}`}
              step={step}
              at={at}
              total={steps.length}
              current={at === index}
              onPick={() => {
                onPick(at);
              }}
            />
          ),
        )}
      </Reveal>
    </Stagger>
  );
}
