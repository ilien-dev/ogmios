import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Crosshair,
  Flag,
  Flame,
  History,
  RefreshCw,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { HomeState, SessionSetup } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
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

/** §6.1: one big button with a topic already chosen, and a few quiet lines. */
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

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col px-10 pt-20 pb-12">
        <p className="text-lead text-ink-soft motion-safe:animate-fade">
          {name === null
            ? t("home.greetingAnon")
            : t("home.greeting", { name })}
        </p>

        <section
          aria-labelledby="topic-label"
          className="mt-14 flex flex-col gap-4 motion-safe:animate-rise"
        >
          <h1 id="topic-label" className="text-sm font-medium text-ink-faint">
            {t("home.topicLabel")}
          </h1>
          <p
            aria-live="polite"
            className="text-display font-semibold text-balance text-ink"
          >
            {topic}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={topic === ""}
              onClick={() => {
                navigate({
                  name: "conversation",
                  setup: quickSetup(home, topic),
                });
              }}
            >
              {t("home.start")}
              <ArrowRight aria-hidden className="size-5" />
            </Button>
            {continueTopic !== null && (
              <Button
                variant="ghost"
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
            {topics.length > 1 && (
              <Button
                variant="ghost"
                icon={<Shuffle aria-hidden className="size-4" />}
                onClick={() => {
                  setTopicIndex((held) => held + 1);
                }}
              >
                {t("home.anotherTopic")}
              </Button>
            )}
            <Button
              variant="ghost"
              icon={<SlidersHorizontal aria-hidden className="size-4" />}
              onClick={() => {
                navigate({ name: "setup", preset: { topic } });
              }}
            >
              {t("home.customize")}
            </Button>
          </div>
        </section>

        <ul className="mt-auto flex flex-col border-t border-line pt-6">
          {home.focus !== null && (
            <HomeLine icon={Crosshair}>
              {t("home.focus", { pattern: home.focus.description })}
            </HomeLine>
          )}
          {home.dueReviews > 0 && (
            <HomeLine
              icon={RefreshCw}
              action={{
                label: t("home.practise"),
                onClick: () => {
                  navigate({
                    name: "practice",
                    patternId: null,
                    format: null,
                    autostart: true,
                  });
                },
              }}
            >
              {t("home.due")}
            </HomeLine>
          )}
          <HomeLine icon={Flame}>
            {streak.days === 0
              ? t("home.streakNone")
              : `${t("home.streak", { count: streak.days })} · ${
                  streak.practicedToday
                    ? t("home.today")
                    : t("home.freezes", { count: streak.freezesLeft })
                }`}
          </HomeLine>
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
      </div>
    </main>
  );
}
