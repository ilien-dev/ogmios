import { ArrowUpRight, CircleCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HomeState, PatternView, Progress } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Block } from "@/components/scene/Relief";
import { MetricCard } from "@/components/scene/MetricCard";
import { BigNumber, StatChip, StatTile } from "@/components/scene/Stats";
import { TargetChart } from "@/components/scene/TargetChart";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";

/** Patterns still being worked on: everything but the mastered ones. */
export function activePatterns(
  patterns: readonly PatternView[],
): PatternView[] {
  return patterns.filter((pattern) => pattern.state !== "mastered");
}

/** A little stack of blocks, the drawing on a card for today. */
function Stack({ lit }: { lit: boolean }): ReactNode {
  return (
    <svg viewBox="-90 -70 180 110" className="h-16 w-full" aria-hidden>
      <Block x={0} y={0} w={60} d={60} h={10} />
      <Block
        x={14}
        y={14}
        w={32}
        d={32}
        h={22}
        z={10}
        look={lit ? "lit" : "plain"}
      />
    </svg>
  );
}

interface TodayCardProps {
  title: string;
  sub: string;
  tag: string;
  tone: "accent" | "correct";
  lit?: boolean;
  children?: ReactNode;
  onClick: () => void;
}

/** One thing for today, as a glass card that takes a click. */
function TodayCard({
  title,
  sub,
  tag,
  tone,
  lit = false,
  children,
  onClick,
}: TodayCardProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-2.5 rounded-xl glass p-4 text-left transition-control hover:shadow-lift"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="font-display text-base font-semibold tracking-tight text-ink">
            {title}
          </span>
          <span className="font-mono text-xs text-ink-faint">{sub}</span>
        </span>
        <ArrowUpRight
          aria-hidden
          className="size-4 shrink-0 text-ink-faint transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-text"
        />
      </span>
      <Stack lit={lit} />
      <span
        className={cn(
          "self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold",
          tone === "accent"
            ? "border-accent/35 bg-accent-soft text-accent-text"
            : "border-correct/30 bg-correct-soft text-correct",
        )}
      >
        {tag}
      </span>
      {children}
    </button>
  );
}

/** The week number of an ISO week, `2026-W39` → `W39`. */
function weekLabel(week: string): string {
  return week.slice(week.indexOf("W"));
}

interface HomeBoardProps {
  home: HomeState;
  progress: Progress | null;
  topic: string;
  /** What starts a conversation on today's topic. */
  onStart: () => void;
  navigate: Navigate;
}

/**
 * The column of glass beside the scene: what is due, how the patterns stand,
 * the time spoken week by week and the two things for today.
 */
export function HomeBoard({
  home,
  progress,
  topic,
  onStart,
  navigate,
}: HomeBoardProps): ReactNode {
  const { t } = useTranslation();
  const patterns = progress?.patterns ?? [];
  const active = activePatterns(patterns);
  const mastered = patterns.length - active.length;
  const toFix = patterns.filter(
    (pattern) => pattern.state === "focus" || pattern.state === "relapse",
  ).length;
  const weeks = (progress?.weeklyMinutes ?? []).slice(-8);
  const thisWeek = weeks.at(-1)?.minutes ?? 0;
  const goal = home.lastSetup?.targetMinutes ?? null;

  return (
    <Stagger className="flex flex-col gap-3.5">
      <Reveal className="flex flex-wrap gap-2">
        <StatChip value={active.length} tone="accent">
          {t("home.board.active", { count: active.length })}
        </StatChip>
        <StatChip value={home.dueReviews}>
          {t("home.board.drills", { count: home.dueReviews })}
        </StatChip>
        <StatChip value={home.dueWords}>
          {t("home.board.words", { count: home.dueWords })}
        </StatChip>
      </Reveal>
      <Reveal className="grid grid-cols-2 gap-3">
        <StatTile
          icon={<CircleCheck aria-hidden className="size-6 text-correct" />}
          label={t("home.board.mastered")}
          value={mastered}
        />
        <StatTile
          icon={<TriangleAlert aria-hidden className="size-6 text-wrong" />}
          label={t("home.board.toFix")}
          value={toFix}
        />
      </Reveal>
      <Reveal>
        <MetricCard
          title={t("home.board.week")}
          number={<BigNumber value={thisWeek} unit="min" />}
          note={t("home.board.weekNote")}
        >
          <Presence>
            {weeks.length > 0 && (
              <Reveal key="chart" kind="fade">
                <TargetChart
                  values={weeks.map((week) => week.minutes)}
                  max={10}
                  labels={weeks.map((week) => weekLabel(week.week))}
                  label={t("home.board.weekChart", { minutes: thisWeek })}
                />
              </Reveal>
            )}
          </Presence>
        </MetricCard>
      </Reveal>
      <Reveal className="grid grid-cols-2 gap-3">
        <TodayCard
          title={t("home.board.chat")}
          sub={
            goal === null
              ? t("home.board.chatFree")
              : t("home.board.chatMinutes", { minutes: goal })
          }
          tag={t("home.board.topicTag")}
          tone="accent"
          lit
          onClick={onStart}
        >
          <span className="line-clamp-2 text-sm text-ink-soft">{topic}</span>
        </TodayCard>
        <TodayCard
          title={t("home.board.review")}
          sub={t("home.board.reviewWords", { count: home.dueWords })}
          tag={
            home.dueWords > 0
              ? t("home.board.reviewTag", { count: home.dueWords })
              : t("home.board.reviewNone")
          }
          tone="correct"
          onClick={() => {
            navigate({ name: "recall" });
          }}
        />
      </Reveal>
    </Stagger>
  );
}
