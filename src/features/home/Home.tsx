import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HomeState, Streak } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { CountUp } from "@/components/motion/CountUp";
import { Stagger } from "@/components/motion/Stagger";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import { homeState } from "@/lib/ipc";
import { HomeCenter } from "./HomeCenter";

function StreakLine({ streak }: { streak: Streak }): ReactNode {
  const { t } = useTranslation();
  if (streak.days === 0) {
    return <p className="text-sm text-ink-soft">{t("home.streakNone")}</p>;
  }
  return (
    <p
      className="text-sm text-ink-soft"
      title={
        streak.practicedToday
          ? t("home.today")
          : t("home.freezes", { count: streak.freezesLeft })
      }
    >
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

/** The partner and today's topic, with the streak over them. */
function Loaded({ home, navigate }: LoadedProps): ReactNode {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4 p-6 nav:px-10">
      <Reveal as="header" kind="fade" index={0}>
        <StreakLine streak={home.streak} />
      </Reveal>
      <Stagger className="flex flex-1 flex-col justify-center">
        <HomeCenter home={home} navigate={navigate} className="min-w-0" />
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
