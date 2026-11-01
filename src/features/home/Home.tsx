import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import type { HomeState, Streak } from "@shared/domain";
import { CountUp } from "@/components/motion/CountUp";
import { Stagger } from "@/components/motion/Stagger";
import { Logo } from "@/components/ui/Logo";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Entry } from "@/app/places";
import { BOOK_PLACES, CONVERSATION_PLACES, placeTarget } from "@/app/places";
import type { Navigate } from "@/app/routes";
import type { Current } from "@/features/books/currentChapter";
import { offered, useUpdate } from "@/features/update/update";
import { errorMessage } from "@/lib/errors";
import { homeState } from "@/lib/ipc";
import { HomeCenter } from "./HomeCenter";
import { HomeColumn } from "./HomeColumn";
import type { EntryData } from "./HomeColumn";
import { Reveal } from "@/components/motion/Reveal";
import { Presence } from "@/components/motion/Presence";

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

function SettingsLink({ navigate }: { navigate: Navigate }): ReactNode {
  const { t } = useTranslation();
  const { state, folded } = useUpdate();
  const waiting = folded && offered(state) !== null;
  const label = t(waiting ? "nav.settingsWaiting" : "nav.settings");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        navigate({ name: "settings" });
      }}
      className="relative grid size-11 shrink-0 place-items-center rounded-full bg-raised text-ink transition-control hover:bg-line"
    >
      <Settings aria-hidden className="size-5" />
      <Presence>
        {waiting && (
          <Reveal
            key="dot"
            as="span"
            kind="scale"
            index={0}
            className="absolute top-2 right-2 size-2 rounded-full bg-accent"
          />
        )}
      </Presence>
    </button>
  );
}

interface LoadedProps {
  home: HomeState;
  navigate: Navigate;
  current: Current | null;
  counts: Partial<Record<Entry, number>>;
}

/** Below the `nav` width the centre goes first, over both sides. */
function Loaded({ home, navigate, current, counts }: LoadedProps): ReactNode {
  const { t } = useTranslation();
  const due = (count = 0): string | null =>
    count > 0 ? t("nav.due", { count }) : null;
  const { days } = home.streak;
  const data: EntryData = {
    drills: due(counts.drills),
    recall: due(counts.recall),
    progress: days > 0 ? t("home.streak", { count: days }) : null,
    vocabulary: current?.chapter.title ?? null,
  };
  const open = (entry: Entry): void => {
    navigate(placeTarget(entry, current));
  };

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-4 px-6 py-4 nav:px-10">
      <Reveal
        as="header"
        kind="fade"
        index={0}
        className="flex items-center justify-between gap-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Logo className="size-8" />
          <StreakLine streak={home.streak} />
        </div>
        <SettingsLink navigate={navigate} />
      </Reveal>
      <Stagger className="grid flex-1 grid-cols-3 content-center items-center gap-4 nav:grid-cols-4 nav:gap-x-8">
        <HomeCenter
          home={home}
          navigate={navigate}
          className="col-span-3 min-w-0 nav:col-span-2 nav:col-start-2 nav:row-start-1"
        />
        <HomeColumn
          section="conversation"
          places={CONVERSATION_PLACES}
          data={data}
          onOpen={open}
          className="nav:col-start-1 nav:row-start-1"
        />
        <HomeColumn
          section="book"
          places={BOOK_PLACES}
          data={data}
          onOpen={open}
          className="col-span-2 nav:col-span-1 nav:col-start-4 nav:row-start-1"
        />
      </Stagger>
    </div>
  );
}

interface HomeProps {
  navigate: Navigate;
  /** The chapter the learner is on. */
  current: Current | null;
  /** What is due today, by place. */
  counts: Partial<Record<Entry, number>>;
}

/**
 * Every place of both sections in view, around the partner and today's topic:
 * the first screen is the whole map.
 */
export function Home({ navigate, current, counts }: HomeProps): ReactNode {
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
              <Reveal key="no-failure" as="span" kind="fade">
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
          <Loaded
            home={home}
            navigate={navigate}
            current={current}
            counts={counts}
          />
        </Reveal>
      )}
    </Presence>
  );
}
