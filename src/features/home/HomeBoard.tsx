import { CircleCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PatternView, Progress, Settings } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { MetricCard } from "@/components/scene/MetricCard";
import { BigNumber, StatChip, StatTile } from "@/components/scene/Stats";
import { TargetChart } from "@/components/scene/TargetChart";
import { Chip } from "@/components/ui/Chip";
import type { Navigate } from "@/app/routes";
import { DRILL_FORMATS } from "@/features/drills/Practice";
import { SessionList } from "@/features/progress/SessionList";
import { VoiceCard } from "@/features/speech/VoiceCard";

/** Patterns still being worked on: everything but the mastered ones. */
export function activePatterns(
  patterns: readonly PatternView[],
): PatternView[] {
  return patterns.filter((pattern) => pattern.state !== "mastered");
}

/** The week number of an ISO week, `2026-W39` → `W39`. */
function weekLabel(week: string): string {
  return week.slice(week.indexOf("W"));
}

interface HomeBoardProps {
  progress: Progress | null;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  /** Deletes a conversation, and reads the progress again without it. */
  onDeleteSession: (sessionId: string) => Promise<void>;
  navigate: Navigate;
}

/**
 * The column of glass beside the scene: how the patterns stand, the time
 * spoken week by week, the voice as its two switches, and the conversations
 * had so far with their feedback. What comes back today is not here: that is
 * Today's.
 */
export function HomeBoard({
  progress,
  settings,
  onSettingsChange,
  onDeleteSession,
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
  const sessions = progress?.sessions ?? null;

  return (
    <Stagger className="flex flex-col gap-3.5">
      <Reveal className="flex flex-wrap gap-2">
        <StatChip value={active.length} tone="accent">
          {t("home.board.active", { count: active.length })}
        </StatChip>
        <StatChip value={sessions?.length ?? 0}>
          {t("home.board.chats", { count: sessions?.length ?? 0 })}
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
      <Reveal
        role="group"
        aria-label={t("home.board.formats")}
        className="flex flex-col gap-2.5 rounded-xl glass p-4.5"
      >
        <span className="text-sm text-ink-soft">{t("home.board.formats")}</span>
        <div className="flex flex-wrap gap-1.5">
          {DRILL_FORMATS.map((format) => (
            <Chip
              key={format}
              title={t(`drillFormat.${format}Hint`)}
              className="h-8 px-3 hover:-translate-y-0.5"
              onClick={() => {
                navigate({ name: "practice", patternId: null, format });
              }}
            >
              {t(`drillFormat.${format}`)}
            </Chip>
          ))}
        </div>
      </Reveal>
      <Reveal>
        <VoiceCard settings={settings} onSettingsChange={onSettingsChange} />
      </Reveal>
      <Reveal
        as="section"
        aria-labelledby="past-chats"
        className="flex flex-col gap-2 rounded-xl glass p-4.5"
      >
        <h2
          id="past-chats"
          className="font-display text-base font-semibold tracking-tight text-ink"
        >
          {t("home.past.title")}
        </h2>
        <div className="relative">
          <Presence swap>
            {sessions === null || sessions.length === 0 ? (
              <Reveal
                key="empty"
                as="p"
                kind="fade"
                className="text-sm text-ink-faint"
              >
                {t("home.past.empty")}
              </Reveal>
            ) : (
              <Reveal key="list" kind="fade">
                <SessionList
                  sessions={sessions}
                  navigate={navigate}
                  onDelete={onDeleteSession}
                />
              </Reveal>
            )}
          </Presence>
        </div>
      </Reveal>
    </Stagger>
  );
}
