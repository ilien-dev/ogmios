import { Fragment } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { History, Mic, Shuffle, SlidersHorizontal } from "lucide-react";
import type {
  HomeState,
  PatternState,
  Progress,
  SessionSetup,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Magnetic } from "@/components/motion/Magnetic";
import type { Tone } from "@/components/scene/Relief";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { SpiralRelief } from "@/components/scene/SpiralRelief";
import { BigNumber } from "@/components/scene/Stats";
import { Button } from "@/components/ui/Button";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { activePatterns } from "./HomeBoard";
import { TodayLine } from "./TodayLine";

export function quickSetup(home: HomeState, topic: string): SessionSetup {
  const last = home.lastSetup;
  if (last === null || (last.mode === "material" && last.material === null)) {
    return {
      topic,
      level: home.profile.level,
      mode: "casual",
      personality: "curiousFriend",
      focusMode: "free",
      targetMinutes: 10,
      material: null,
      continuePrevious: false,
    };
  }
  return { ...last, topic };
}

const TONE: Record<PatternState, Tone> = {
  focus: "focus",
  relapse: "wrong",
  improving: "correct",
  detected: "quiet",
  mastered: "correct",
};

const STATE_TEXT: Record<PatternState, string> = {
  focus: "text-accent-text",
  relapse: "text-wrong",
  improving: "text-correct",
  detected: "text-ink-soft",
  mastered: "text-correct",
};

interface HomeCenterProps {
  home: HomeState;
  progress: Progress | null;
  topic: string;
  /** Moves to the next suggested topic, when there are several. */
  onNextTopic: (() => void) | null;
  navigate: Navigate;
  className?: string;
}

/**
 * The scene of Home: the greeting, the topic of the day and the ways into a
 * conversation over the spiral raised in 3D, with the focus of the learner
 * lit at its centre and the patterns being worked on along the bottom.
 */
export function HomeCenter({
  home,
  progress,
  topic,
  onNextTopic,
  navigate,
  className,
}: HomeCenterProps): ReactNode {
  const { t } = useTranslation();
  const { continueTopic, focus } = home;
  const name = home.profile.name;
  const active = activePatterns(progress?.patterns ?? []);
  const rate = focus?.correctRate ?? null;
  const heads = [
    t("home.board.colPattern"),
    t("home.board.colState"),
    t("home.board.colRight"),
    t("home.board.colSeen"),
  ];

  return (
    <Scene
      label={t("home.board.scene")}
      zoom
      className={className}
      header={
        <>
          <SceneTitle>
            {name === null
              ? t("home.greetingAnon")
              : t("home.greeting", { name })}
          </SceneTitle>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex min-h-10 max-w-full items-center rounded-full glass px-4">
              <span className="mr-2 shrink-0 text-sm text-ink-faint">
                {t("home.topicLabel")} ·
              </span>
              <span
                aria-live="polite"
                data-testid="topic"
                className="relative min-w-0"
              >
                <Presence swap>
                  <Reveal
                    key={topic}
                    as="span"
                    kind="fade"
                    index={0}
                    className="block truncate text-sm font-medium text-ink"
                  >
                    {topic}
                  </Reveal>
                </Presence>
              </span>
            </span>
            <Presence>
              {onNextTopic !== null && (
                <Reveal key="topics" as="span" kind="fade">
                  <Button
                    className="group h-10"
                    icon={
                      <Shuffle
                        aria-hidden
                        className="size-4 transition-transform duration-300 ease-out-expo group-hover:-rotate-12"
                      />
                    }
                    onClick={onNextTopic}
                  >
                    {t("home.anotherTopic")}
                  </Button>
                </Reveal>
              )}
            </Presence>
            <Button
              className="group h-10"
              icon={
                <SlidersHorizontal
                  aria-hidden
                  className="size-4 transition-transform duration-300 ease-out-expo group-hover:scale-110"
                />
              }
              onClick={() => {
                navigate({ name: "setup", preset: { topic } });
              }}
            >
              {t("home.customize")}
            </Button>
            <Presence>
              {continueTopic !== null && (
                <Reveal key="continueTopic" as="span" kind="fade">
                  <Button
                    className="group h-10"
                    icon={
                      <History
                        aria-hidden
                        className="size-4 transition-transform duration-300 ease-out-expo group-hover:-rotate-12"
                      />
                    }
                    onClick={() => {
                      navigate({
                        name: "conversation",
                        setup: {
                          ...quickSetup(home, continueTopic),
                          continuePrevious: true,
                        },
                      });
                    }}
                  >
                    {t("home.continueLast")}
                  </Button>
                </Reveal>
              )}
            </Presence>
            <Magnetic>
              <Button
                variant="primary"
                disabled={topic === ""}
                className="group"
                icon={
                  <Mic
                    aria-hidden
                    className="size-4 transition-transform duration-300 ease-out-expo group-enabled:group-hover:scale-110"
                  />
                }
                onClick={() => {
                  navigate({
                    name: "conversation",
                    setup: quickSetup(home, topic),
                  });
                }}
              >
                {t("home.start")}
              </Button>
            </Magnetic>
          </div>
          <Presence>
            {focus !== null && (
              <Reveal
                key="focus"
                as="p"
                className="max-w-prose text-sm text-ink-soft"
              >
                {t("home.focusLead")}{" "}
                <span className="font-medium text-ink">
                  {focus.description}
                </span>
              </Reveal>
            )}
          </Presence>
        </>
      }
      overlay={
        <Reveal
          kind="scale"
          className="absolute top-2/5 right-8 z-10 flex w-64 flex-col gap-1.5 rounded-xl glass-float px-4.5 py-4"
        >
          <span className="font-display text-base font-semibold tracking-tight text-ink">
            {t("home.board.focus")}
          </span>
          <Presence swap>
            {focus === null ? (
              <Reveal
                key="none"
                as="span"
                kind="fade"
                className="text-sm text-ink-faint"
              >
                {t("home.board.focusNone")}
              </Reveal>
            ) : (
              <Reveal key="focus" kind="fade" className="flex flex-col gap-1.5">
                <span className="text-sm text-ink-faint">
                  {focus.description} ·{" "}
                  {t("progress.seen", { count: focus.sessionsSeen })}
                </span>
                <Presence>
                  {rate !== null && (
                    <Reveal key="rate" as="span" kind="fade">
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
                  {t("home.board.focusRight")}
                </span>
              </Reveal>
            )}
          </Presence>
        </Reveal>
      }
      footer={
        <Reveal className="flex flex-col gap-3 rounded-xl glass px-5.5 py-4.5">
          <span className="font-display text-base tracking-tight text-ink">
            {t("home.board.patterns")}
          </span>
          <Presence swap>
            {active.length === 0 ? (
              <Reveal
                key="empty"
                as="span"
                kind="fade"
                className="text-sm text-ink-faint"
              >
                {t("progress.patternsEmpty")}
              </Reveal>
            ) : (
              <Reveal
                key="patterns"
                kind="fade"
                className="grid grid-cols-6 items-center gap-x-3.5 gap-y-2 text-sm"
              >
                {heads.map((head, at) => (
                  <span
                    key={head}
                    className={cn(
                      "font-mono text-xs tracking-wider text-ink-faint uppercase",
                      at === 0 && "col-span-3",
                    )}
                  >
                    {head}
                  </span>
                ))}
                {active.slice(0, 3).map((pattern) => (
                  <Fragment key={pattern.id}>
                    <span className="col-span-3 truncate text-ink">
                      {pattern.description}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5",
                        STATE_TEXT[pattern.state],
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 animate-breathe rounded-full bg-current"
                      />
                      {t(`patternState.${pattern.state}`)}
                    </span>
                    <span className="font-mono text-ink-soft">
                      {pattern.correctRate === null
                        ? "—"
                        : `${Math.round(pattern.correctRate * 100)} %`}
                    </span>
                    <span className="font-mono text-ink-soft">
                      {pattern.sessionsSeen}
                    </span>
                  </Fragment>
                ))}
              </Reveal>
            )}
          </Presence>
          <TodayLine home={home} topic={topic} navigate={navigate} />
        </Reveal>
      }
    >
      <SpiralRelief
        pins={active.map((pattern) => ({
          tone: TONE[pattern.state],
          tip: {
            title: pattern.description,
            lines: [t(`patternState.${pattern.state}`)],
          },
        }))}
        label={t("home.board.relief")}
        className="size-full max-w-4xl px-6 pt-36 pb-28"
      />
    </Scene>
  );
}
