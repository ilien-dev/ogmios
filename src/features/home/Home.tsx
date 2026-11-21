import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HomeState, Progress, Streak } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { CountUp } from "@/components/motion/CountUp";
import { Stagger } from "@/components/motion/Stagger";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { getProgress, homeState } from "@/lib/ipc";
import { HomeBoard } from "./HomeBoard";
import { HomeCenter, quickSetup } from "./HomeCenter";

function StreakLine({ streak }: { streak: Streak }): ReactNode {
  const { t } = useTranslation();
  if (streak.days === 0) {
    return (
      <p className="inline-flex rounded-full glass px-3.5 py-1.5 text-sm text-ink-soft">
        {t("home.streakNone")}
      </p>
    );
  }
  return (
    <p
      className="inline-flex items-center gap-2 rounded-full glass px-3.5 py-1.5 text-sm text-ink-soft tabular-nums"
      title={
        streak.practicedToday
          ? t("home.today")
          : t("home.freezes", { count: streak.freezesLeft })
      }
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          streak.practicedToday ? "animate-breathe bg-mint" : "bg-line-strong",
        )}
      />
      <CountUp
        value={streak.days}
        format={(count) => t("home.streak", { count })}
      />
    </p>
  );
}

interface LoadedProps {
  home: HomeState;
  navigate: Navigate;
}

/**
 * The column of glass on the left and the scene on the right, as in the
 * brand proposal; one under the other when the window is narrow.
 */
function Loaded({ home, navigate }: LoadedProps): ReactNode {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [topicIndex, setTopicIndex] = useState(0);
  const topics = home.suggestedTopics;
  const topic =
    topics.length > 0
      ? (topics[topicIndex % topics.length] ?? "")
      : (home.lastSetup?.topic ?? "");

  useEffect(() => {
    let live = true;
    getProgress()
      .then((loaded) => {
        if (live) {
          setProgress(loaded);
        }
      })
      .catch(() => {
        // The board only shows less without it; Home itself stands.
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row">
      <div className="scrollbar-none flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md wide:overflow-y-auto wide:pb-2">
        <Reveal as="header" kind="fade" index={0}>
          <StreakLine streak={home.streak} />
        </Reveal>
        <HomeBoard
          home={home}
          progress={progress}
          topic={topic}
          navigate={navigate}
          onStart={() => {
            navigate({ name: "conversation", setup: quickSetup(home, topic) });
          }}
        />
      </div>
      <Stagger className="flex min-h-160 min-w-0 flex-1 flex-col">
        <HomeCenter
          home={home}
          progress={progress}
          topic={topic}
          navigate={navigate}
          onNextTopic={
            topics.length > 1
              ? () => {
                  setTopicIndex((held) => held + 1);
                }
              : null
          }
          className="flex-1"
        />
      </Stagger>
    </div>
  );
}

interface HomeProps {
  navigate: Navigate;
}

/**
 * The conversation section's own screen: the partner, today's topic and what
 * it steers towards. The places of both sections are on the rail beside it.
 */
export function Home({ navigate }: HomeProps): ReactNode {
  const { t } = useTranslation();
  const [home, setHome] = useState<HomeState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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

  return (
    <Presence swap>
      {home === null ? (
        <Reveal
          key={failure === null ? "loading" : "failed"}
          as="main"
          kind="fade"
          className="grid h-full place-items-center"
        >
          <Presence swap>
            {failure === null ? (
              <Reveal key="waiting" as="span" kind="fade">
                <Spinner />
              </Reveal>
            ) : (
              <Notice key="failure" tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            )}
          </Presence>
        </Reveal>
      ) : (
        <Reveal
          key="loaded"
          as="main"
          kind="fade"
          layoutScroll
          className="h-full overflow-y-auto"
        >
          <Loaded home={home} navigate={navigate} />
        </Reveal>
      )}
    </Presence>
  );
}
