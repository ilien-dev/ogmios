import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Flag,
  History,
  Mic,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { HomeState, SessionSetup } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { Waveform } from "@/components/ui/Waveform";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { homeState } from "@/lib/ipc";
import { HomeLine } from "./HomeLine";

interface HomeProps {
  navigate: Navigate;
}

function quickSetup(home: HomeState, topic: string): SessionSetup {
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

/**
 * §6.1: today's topic with its start button, today's numbers on grey tiles
 * that lead to where they are done, and a few quiet lines.
 */
export function Home({ navigate }: HomeProps): ReactNode {
  const { t } = useTranslation();
  const [home, setHome] = useState<HomeState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [topicIndex, setTopicIndex] = useState(0);

  useEffect(() => {
    let live = true;
    homeState()
      .then((loaded) => {
        if (live) {
          setHome(loaded);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    return () => {
      live = false;
    };
  }, []);

  if (home === null) {
    return (
      <main className="grid h-full place-items-center">
        {failure === null ? (
          <Spinner />
        ) : (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </main>
    );
  }

  const topics = home.suggestedTopics;
  const topic =
    topics.length > 0
      ? (topics[topicIndex % topics.length] ?? "")
      : (home.lastSetup?.topic ?? "");
  const name = home.profile.name;
  const { streak, continueTopic } = home;
  const streakNote =
    streak.days === 0
      ? t("home.streakNone")
      : streak.practicedToday
        ? t("home.today")
        : t("home.freezes", { count: streak.freezesLeft });
  const hasLines =
    home.activeChallenge !== null ||
    home.rotationSuggestion !== null ||
    home.levelSuggestion !== null;

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-10 pt-10 pb-14">
        <h1 className="font-display text-display font-light text-balance text-ink motion-safe:animate-fade">
          {name === null
            ? t("home.greetingAnon")
            : t("home.greeting", { name })}
        </h1>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="flex flex-col-reverse gap-3 rounded-lg bg-raised px-5 py-4">
            <p className="text-xs text-ink-soft">{t("home.streakLabel")}</p>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="font-display text-title font-light text-ink">
                {streak.days}
              </p>
              <p className="text-sm text-ink-soft">{streakNote}</p>
            </div>
          </div>
          <Tile
            label={t("home.wordsLabel")}
            value={home.dueWords}
            tag={t("nav.groups.book")}
            tone="book"
            onClick={() => {
              navigate({ name: "recall" });
            }}
          />
          <Tile
            label={t("home.patternsLabel")}
            value={home.dueReviews}
            tag={t("nav.groups.conversation")}
            tone="you"
            onClick={() => {
              navigate({
                name: "practice",
                patternId: null,
                format: null,
                autostart: false,
              });
            }}
          />
        </div>

        <div className="flex flex-wrap items-start gap-6">
          <section
            aria-labelledby="topic-label"
            className="relative flex min-w-0 flex-[2_1_32rem] flex-col gap-5 overflow-hidden rounded-xl border border-line p-7 bg-hero motion-safe:animate-rise"
          >
            <Waveform className="pointer-events-none absolute top-5 -right-2 h-20 text-you/45" />
            <p
              id="topic-label"
              className="relative self-start rounded-sm bg-you-soft px-2 py-0.5 text-xs font-medium text-you"
            >
              {t("home.topicLabel")}
            </p>
            <p
              aria-live="polite"
              className="relative font-display text-title font-normal text-balance text-ink"
            >
              {topic}
            </p>
            {home.focus !== null && (
              <p className="relative max-w-prose text-sm text-ink-soft">
                {t("home.focusLead")}{" "}
                <span className="font-medium text-ink underline decoration-you/50 decoration-4 underline-offset-2">
                  {home.focus.description}
                </span>
              </p>
            )}
            <div className="relative mt-1 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={topic === ""}
                icon={<Mic aria-hidden className="size-4" />}
                onClick={() => {
                  navigate({
                    name: "conversation",
                    setup: quickSetup(home, topic),
                  });
                }}
              >
                {t("home.start")}
              </Button>
              {topics.length > 1 && (
                <Button
                  icon={<Shuffle aria-hidden className="size-4" />}
                  onClick={() => {
                    setTopicIndex((held) => held + 1);
                  }}
                >
                  {t("home.anotherTopic")}
                </Button>
              )}
              <Button
                icon={<SlidersHorizontal aria-hidden className="size-4" />}
                onClick={() => {
                  navigate({ name: "setup", preset: { topic } });
                }}
              >
                {t("home.customize")}
              </Button>
              {continueTopic !== null && (
                <Button
                  variant="ghost"
                  className="ml-auto"
                  icon={<History aria-hidden className="size-4" />}
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
              )}
            </div>
          </section>

          {hasLines && (
            <section
              aria-labelledby="today-label"
              className="flex min-w-0 flex-[1_1_18rem] flex-col"
            >
              <h2
                id="today-label"
                className="mb-2 font-display text-lg text-ink"
              >
                {t("home.todayList")}
              </h2>
              <ul className="flex flex-col divide-y divide-line-strong border-y border-line-strong">
                {home.activeChallenge !== null && (
                  <HomeLine icon={Flag}>
                    {t("home.challenge", { text: home.activeChallenge })}
                  </HomeLine>
                )}
                {home.rotationSuggestion !== null && (
                  <HomeLine
                    icon={Sparkles}
                    action={{
                      label: t("home.tryIt"),
                      onClick: () => {
                        navigate({
                          name: "setup",
                          preset: {
                            topic,
                            mode: home.rotationSuggestion ?? "casual",
                          },
                        });
                      },
                    }}
                  >
                    {t("home.rotation", {
                      mode: t(`mode.${home.rotationSuggestion}`).toLowerCase(),
                    })}
                  </HomeLine>
                )}
                {home.levelSuggestion !== null && (
                  <HomeLine
                    icon={TrendingUp}
                    action={{
                      label: t("home.switchLevel"),
                      onClick: () => {
                        navigate({
                          name: "setup",
                          preset: {
                            topic,
                            level: home.levelSuggestion ?? "intermediate",
                          },
                        });
                      },
                    }}
                  >
                    {t("home.levelSuggestion", {
                      level: t(`level.${home.levelSuggestion}`).toLowerCase(),
                    })}
                  </HomeLine>
                )}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

interface TileProps {
  label: string;
  value: number;
  /** The group it belongs to, in that group's colour. */
  tag: string;
  tone: "you" | "book";
  onClick: () => void;
}

/** One of today's numbers, on a grey tile that leads to where it is done. */
function Tile({ label, value, tag, tone, onClick }: TileProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col-reverse gap-3 rounded-lg bg-raised px-5 py-4 text-left transition-colors duration-150 hover:bg-line"
    >
      <span className="flex items-center gap-1.5 text-xs text-ink-soft">
        {label}
        <ArrowRight
          aria-hidden
          className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="font-display text-title font-light text-ink">
          {value}
        </span>
        <span
          className={cn(
            "rounded-sm px-1.5 py-0.5 text-xs",
            tone === "book" ? "bg-book-soft text-book" : "bg-you-soft text-you",
          )}
        >
          {tag}
        </span>
      </span>
    </button>
  );
}
