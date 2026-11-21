import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Dumbbell,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import type {
  Drill,
  DrillFormat,
  HomeState,
  PatternState,
  Progress,
} from "@shared/domain";
import { Magnetic } from "@/components/motion/Magnetic";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { BigNumber, StatChip, StatTile } from "@/components/scene/Stats";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import { getProgress, homeState, startDrill } from "@/lib/ipc";
import { BarRelief } from "./BarRelief";
import { DrillRunner } from "./DrillRunner";
import { HubScreen, RunBackdrop } from "./ScreenParts";

const FORMATS = [
  "sameStructure",
  "transformation",
  "guidedChat",
  "spotError",
] as const;

/** The states a pattern climbs through, in the order of the relief. */
const CLIMB = ["detected", "focus", "improving", "mastered"] as const;

interface PracticeProps {
  patternId: string | null;
  format: DrillFormat | null;
  autostart: boolean;
  navigate: Navigate;
}

type Phase =
  | { name: "landing" }
  | { name: "loading" }
  | { name: "running"; drill: Drill }
  | { name: "failed"; message: string };

/**
 * Names what is on the screen. Each round is its own step: one that came back
 * while the last was still leaving would keep that one's place in the drill.
 */
function stepOf(phase: Phase): string {
  if (phase.name === "running") {
    return phase.drill.id;
  }
  return phase.name === "failed" ? "landing" : phase.name;
}

/** How many patterns stand in each step of the climb; a relapse is to fix. */
function byState(
  progress: Progress | null,
): Record<(typeof CLIMB)[number], number> {
  const counts: Record<PatternState, number> = {
    detected: 0,
    focus: 0,
    improving: 0,
    mastered: 0,
    relapse: 0,
  };
  for (const pattern of progress?.patterns ?? []) {
    counts[pattern.state] += 1;
  }
  return { ...counts, focus: counts.focus + counts.relapse };
}

interface LandingProps {
  home: HomeState | null;
  progress: Progress | null;
  failure: string | null;
  onStart: () => void;
  onFormat: (format: DrillFormat) => void;
}

/**
 * The drills' own screen: how the patterns stand and the formats on the
 * left, and on the right the way into today's round over the patterns
 * raised by state, the focus lit.
 */
function Landing({
  home,
  progress,
  failure,
  onStart,
  onFormat,
}: LandingProps): ReactNode {
  const { t } = useTranslation();
  const due = home?.dueReviews ?? null;
  const counts = byState(progress);
  const active = (progress?.patterns ?? []).length - counts.mastered;
  const focus = home?.focus ?? null;
  const rate = focus?.correctRate ?? null;

  return (
    <HubScreen
      aside={
        <>
          <Reveal className="flex flex-wrap gap-2">
            <StatChip value={due ?? "–"} tone="accent">
              {t("drills.board.due")}
            </StatChip>
            <StatChip value={active}>
              {t("drills.board.active", { count: active })}
            </StatChip>
          </Reveal>
          <Reveal className="grid grid-cols-2 gap-3">
            <StatTile
              icon={<TrendingUp aria-hidden className="size-6 text-correct" />}
              label={t("drills.board.improving")}
              value={counts.improving}
            />
            <StatTile
              icon={<TriangleAlert aria-hidden className="size-6 text-wrong" />}
              label={t("drills.board.toFix")}
              value={counts.focus}
            />
          </Reveal>
          <Reveal
            as="section"
            aria-labelledby="formats"
            className="flex flex-col gap-3"
          >
            <h2
              id="formats"
              className="px-1 font-display text-base tracking-tight text-ink"
            >
              {t("drills.formats")}
            </h2>
            <Stagger as="ul" className="grid grid-cols-2 gap-3">
              {FORMATS.map((item) => (
                <Reveal key={item} as="li">
                  <button
                    type="button"
                    onClick={() => {
                      onFormat(item);
                    }}
                    className="group flex size-full flex-col gap-2 rounded-xl glass p-4 text-left transition-control hover:shadow-lift"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-display text-base font-semibold tracking-tight text-ink">
                        {t(`drillFormat.${item}`)}
                      </span>
                      <ArrowUpRight
                        aria-hidden
                        className="size-4 shrink-0 text-ink-faint transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-text"
                      />
                    </span>
                    <span className="text-sm text-ink-soft">
                      {t(`drillFormat.${item}Hint`)}
                    </span>
                  </button>
                </Reveal>
              ))}
            </Stagger>
          </Reveal>
        </>
      }
      scene={
        <Scene
          label={t("drills.board.scene")}
          className="flex-1"
          header={
            <>
              <SceneTitle>{t("drills.title")}</SceneTitle>
              <p className="max-w-prose text-ink-soft">{t("drills.intro")}</p>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex min-h-10 items-center gap-2 rounded-full glass px-4 text-sm text-ink-soft">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 animate-breathe rounded-full bg-mint"
                  />
                  {due === null
                    ? " "
                    : due > 0
                      ? t("drills.dueCount", { count: due })
                      : t("drills.nothingDue")}
                </span>
                <Magnetic>
                  <Button
                    variant="primary"
                    className="group"
                    icon={
                      <Dumbbell
                        aria-hidden
                        className="size-4 transition-transform duration-300 ease-out-expo group-hover:-rotate-12"
                      />
                    }
                    onClick={onStart}
                  >
                    {due !== null && due > 0
                      ? t("drills.startDue")
                      : t("drills.startAny")}
                  </Button>
                </Magnetic>
              </div>
              <Presence>
                {failure !== null && (
                  <Notice key="failure" tone="danger">
                    {t("common.error", { message: failure })}
                  </Notice>
                )}
              </Presence>
            </>
          }
          overlay={
            <Reveal
              kind="scale"
              className="absolute top-1/2 right-8 z-10 hidden w-64 flex-col gap-1.5 rounded-xl glass-float px-4.5 py-4 nav:flex"
            >
              <span className="font-display text-base font-semibold tracking-tight text-ink">
                {t("drills.board.focus")}
              </span>
              <Presence swap>
                {focus === null ? (
                  <Reveal
                    key="none"
                    as="span"
                    kind="fade"
                    className="text-sm text-ink-faint"
                  >
                    {t("drills.board.focusNone")}
                  </Reveal>
                ) : (
                  <Reveal
                    key={focus.id}
                    kind="fade"
                    className="flex flex-col gap-1.5"
                  >
                    <span className="text-sm text-ink-faint">
                      {focus.description}
                    </span>
                    <Presence>
                      {rate !== null && (
                        <Reveal key="rate" kind="fade">
                          <BigNumber
                            value={Math.round(rate * 100)}
                            unit="%"
                            size="md"
                            className="text-accent-text"
                          />
                        </Reveal>
                      )}
                    </Presence>
                    <span className="text-sm text-ink-faint">
                      {t("drills.board.focusRight")}
                    </span>
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          }
          footer={
            <Reveal className="flex flex-col gap-3 rounded-xl glass px-5.5 py-4.5">
              <div className="grid grid-cols-4 gap-3">
                {CLIMB.map((state) => (
                  <span key={state} className="flex flex-col gap-1">
                    <span className="font-mono text-xs tracking-wider text-ink-faint uppercase">
                      {t(`patternState.${state}`)}
                    </span>
                    <span className="font-display text-3xl font-light text-ink tabular-nums">
                      {counts[state]}
                    </span>
                  </span>
                ))}
              </div>
              <p className="text-sm text-ink-faint">
                {t("drills.summaryNote")}
              </p>
            </Reveal>
          }
        >
          <BarRelief
            label={t("drills.board.relief", counts)}
            bars={CLIMB.map((state) => ({
              key: state,
              value: counts[state],
              look: state === "focus" ? "lit" : "plain",
              tip: {
                title: t(`patternState.${state}`),
                lines: [t("scene.tip.patterns", { count: counts[state] })],
              },
              pin:
                state === "focus" && due !== null && due > 0
                  ? "focus"
                  : undefined,
            }))}
            className="size-full max-w-3xl px-6 pt-60 pb-44"
          />
        </Scene>
      }
    />
  );
}

/** §9: short practice rounds on the patterns in memory. */
export function Practice({
  patternId,
  format,
  autostart,
  navigate,
}: PracticeProps): ReactNode {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>(
    autostart ? { name: "loading" } : { name: "landing" },
  );
  const [home, setHome] = useState<HomeState | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const autostarted = useRef(false);

  const begin = async (chosen: DrillFormat | null): Promise<void> => {
    setPhase({ name: "loading" });
    try {
      const drill = await startDrill(patternId, chosen);
      setPhase({ name: "running", drill });
    } catch (error) {
      setPhase({ name: "failed", message: errorMessage(error) });
    }
  };

  useEffect(() => {
    if (autostart && !autostarted.current) {
      autostarted.current = true;
      void begin(format);
      return;
    }
    let live = true;
    void homeState().then((loaded) => {
      if (live) {
        setHome(loaded);
      }
    });
    getProgress()
      .then((loaded) => {
        if (live) {
          setProgress(loaded);
        }
      })
      .catch(() => {
        // The column only shows less without it; the drills stand.
      });
    return () => {
      live = false;
    };
  }, []);

  const body = (): ReactNode => {
    if (phase.name === "running") {
      return (
        <DrillRunner
          drill={phase.drill}
          onAgain={() => void begin(format)}
          onClose={() => {
            navigate({
              name: "practice",
              patternId: null,
              format: null,
              autostart: false,
            });
          }}
        />
      );
    }

    if (phase.name === "loading") {
      return (
        <RunBackdrop>
          <main className="grid h-full place-items-center">
            <p className="flex items-center gap-3 rounded-full glass px-5 py-3 text-sm text-ink-soft">
              <Spinner />
              {t("drills.loading")}
            </p>
          </main>
        </RunBackdrop>
      );
    }

    return (
      <Landing
        home={home}
        progress={progress}
        failure={phase.name === "failed" ? phase.message : null}
        onStart={() => {
          navigate({
            name: "practice",
            patternId,
            format: null,
            autostart: true,
          });
        }}
        onFormat={(item) => {
          navigate({
            name: "practice",
            patternId,
            format: item,
            autostart: true,
          });
        }}
      />
    );
  };

  return (
    <div className="relative h-full">
      <Presence swap>
        <Reveal key={stepOf(phase)} kind="fade" className="h-full">
          {body()}
        </Reveal>
      </Presence>
    </div>
  );
}
