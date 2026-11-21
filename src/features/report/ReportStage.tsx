import { motion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Tilt } from "@/components/motion/Tilt";
import type { Tone } from "@/components/scene/Relief";
import { Scene } from "@/components/scene/Scene";
import { SpiralRelief } from "@/components/scene/SpiralRelief";
import { BigNumber } from "@/components/scene/Stats";
import { cn } from "@/lib/cn";
import { EASE_OUT } from "@/lib/motion";
import { formatNumber } from "@/lib/text";
import { CardTitle } from "./cards/CardTitle";
import type { MetricKey } from "./cards/MetricsCard";
import { ROWS, metricValue } from "./cards/MetricsCard";
import type { Step } from "./steps";
import { stepTag, stepTitle } from "./stepMeta";
import { trend } from "./trend";

type MetricsStep = Extract<Step, { kind: "metrics" }>;

interface RoundProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  nudge: string;
}

/** A round glass button over the scene. */
function Round({
  label,
  icon: Icon,
  onClick,
  disabled,
  nudge,
}: RoundProps): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="group flex size-11 cursor-pointer items-center justify-center rounded-full glass text-ink transition-control hover:enabled:shadow-lift disabled:cursor-default disabled:text-ink-faint"
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4 transition-transform duration-300 ease-out-expo",
          nudge,
        )}
      />
    </button>
  );
}

/** The rows the bottom panel shows beside the minutes spoken. */
const STRIP: readonly MetricKey[] = [
  "userWords",
  "wordsPerTurn",
  "mtld",
  "userShare",
];

/** The glass panel along the scene's bottom: this session against before. */
function Compared({ card }: { card: MetricsStep["card"] }): ReactNode {
  const { t, i18n } = useTranslation();
  const { current, previous } = card;
  const show = (key: MetricKey, n: number, digits: number): string => {
    const text = formatNumber(n, i18n.language, digits);
    return key === "userShare"
      ? t("report.metrics.percent", { value: text })
      : text;
  };
  const change = (
    key: MetricKey,
    now: number,
    digits: number,
    higherIsBetter: boolean,
  ): ReactNode => {
    const before = previous === null ? null : metricValue(previous, key);
    if (before === null) {
      return null;
    }
    const moved = trend(now, before, digits, higherIsBetter);
    if (moved.flat) {
      return <span className="text-ink-faint">=</span>;
    }
    const sign = moved.delta > 0 ? "+" : "−";
    return (
      <span
        className={moved.better === true ? "text-accent-text" : "text-partial"}
      >
        {sign}
        {formatNumber(Math.abs(moved.delta), i18n.language, digits)}
      </span>
    );
  };
  const rows = ROWS.filter((row) => STRIP.includes(row.key));
  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-3.5 rounded-xl glass px-5.5 py-4">
      <div className="flex min-w-44 flex-col gap-0.5">
        <span className="text-base text-ink">{t("report.metrics.title")}</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <BigNumber
            value={current.speechMinutes}
            format={(n) => formatNumber(n, i18n.language, 1)}
            size="md"
            unit={t("report.board.speaking")}
          />
          <span className="font-mono text-sm">
            {change("speechMinutes", current.speechMinutes, 1, true)}
          </span>
        </span>
      </div>
      <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-3.5 gap-y-2 text-sm nav:grid-cols-4">
        {rows.map(({ key, digits, higherIsBetter }) => {
          const now = metricValue(current, key);
          if (now === null) {
            return null;
          }
          return (
            <div key={key} className="flex flex-col gap-1">
              <dt className="truncate font-mono text-xs tracking-wider text-ink-faint uppercase">
                {t(`report.metrics.${key}`)}
              </dt>
              <dd className="flex gap-1.5 font-mono text-ink">
                {show(key, now, digits)}
                {change(key, now, digits, higherIsBetter)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** The pins of the relief: the focus lit, each detail a warning. */
function pinsOf(steps: readonly Step[]): Tone[] {
  return steps.flatMap((step): Tone[] => {
    if (step.kind === "focus") {
      return ["focus"];
    }
    if (step.kind === "minors") {
      return step.cards.map((): Tone => "wrong");
    }
    return [];
  });
}

interface ReportStageProps {
  steps: readonly Step[];
  index: number;
  /** "2 of 9", for the dots and the slide. */
  where: string;
  body: ReactNode;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}

/**
 * The scene of the report: the step's tag and thin title, and its card raised
 * over the dimmed relief, tilted towards the viewer. The metrics of the
 * session along the bottom, as long as the card on show is not them.
 */
export function ReportStage({
  steps,
  index,
  where,
  body,
  onPrevious,
  onNext,
  className,
}: ReportStageProps): ReactNode {
  const { t } = useTranslation();
  const step = steps[index];
  const last = index >= steps.length - 1;
  const metrics = steps.find(
    (item): item is MetricsStep => item.kind === "metrics",
  );

  return (
    <Scene
      label={t("report.board.scene")}
      className={className}
      header={
        <div className="relative">
          <Presence swap>
            <Reveal
              key={index}
              as="section"
              kind="slide"
              aria-roledescription="slide"
              aria-label={where}
              className="flex flex-col gap-6"
            >
              {/* The spacer keeps the title clear of the buttons over it,
                  and wraps above it when the scene is narrow. */}
              <div className="flex flex-wrap-reverse items-start gap-x-4 gap-y-3">
                <div className="flex min-w-64 flex-1 flex-col gap-2.5">
                  <span className="inline-flex self-start rounded-full bg-mint px-3 py-1 text-xs font-semibold text-on-cta">
                    {step === undefined
                      ? where
                      : `${stepTag(step, t)} · ${where}`}
                  </span>
                  <CardTitle>
                    {step === undefined ? "" : stepTitle(step, t)}
                  </CardTitle>
                </div>
                <span aria-hidden className="h-11 w-60 shrink-0" />
              </div>
              <div className="flex justify-center perspective-distant">
                <Tilt className="w-full max-w-2xl transform-3d">
                  <motion.article
                    initial={{ rotateX: 0 }}
                    animate={{ rotateX: 6 }}
                    transition={{ duration: 0.9, ease: EASE_OUT }}
                    className="flex origin-bottom flex-col rounded-2xl glass-float p-7 outline-1 outline-accent/40 nav:px-8"
                  >
                    {body}
                  </motion.article>
                </Tilt>
              </div>
            </Reveal>
          </Presence>
        </div>
      }
      overlay={
        <Reveal
          kind="fade"
          className="absolute top-6 right-7 z-20 flex items-center gap-2.5"
        >
          <div
            role="img"
            aria-label={where}
            className="mr-1 flex items-center gap-1.5"
          >
            {steps.map((item, at) => (
              <span
                key={`${item.kind}-${at}`}
                className="relative size-1.5 rounded-full bg-line-strong"
              >
                {at === index && (
                  <motion.span
                    layoutId="report-dot"
                    className="absolute -inset-0.5 animate-breathe rounded-full bg-mint"
                  />
                )}
              </span>
            ))}
          </div>
          <Round
            label={t("report.previous")}
            icon={ArrowLeft}
            disabled={index === 0}
            nudge="group-enabled:group-hover:-translate-x-0.5"
            onClick={onPrevious}
          />
          <Presence>
            {!last && (
              <Reveal key="next" as="span" kind="scale" index={0}>
                <Round
                  label={t("report.next")}
                  icon={ArrowRight}
                  nudge="group-hover:translate-x-0.5"
                  onClick={onNext}
                />
              </Reveal>
            )}
          </Presence>
        </Reveal>
      }
      footer={
        <Presence>
          {metrics !== undefined && step?.kind !== "metrics" && (
            <Reveal key="compared">
              <Compared card={metrics.card} />
            </Reveal>
          )}
        </Presence>
      }
    >
      <SpiralRelief
        dim
        pins={pinsOf(steps)}
        className="size-full max-w-3xl px-6 pt-72 pb-4"
      />
    </Scene>
  );
}
