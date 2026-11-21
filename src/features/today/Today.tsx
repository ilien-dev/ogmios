import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarCheck,
  ChevronRight,
  Flame,
  Layers,
  ListChecks,
  Mic,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HomeState } from "@shared/domain";
import type { ListeningState } from "@shared/listening";
import type { StructuresState } from "@shared/structures";
import { Magnetic } from "@/components/motion/Magnetic";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { StatChip, StatTile } from "@/components/scene/Stats";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { nextTab } from "@/features/books/bookTabs";
import { chapterName } from "@/features/books/chapterName";
import type { Current } from "@/features/books/currentChapter";
import { quickSetup } from "@/features/home/HomeCenter";
import { DEFAULT_SIZE } from "@/features/structures/structureText";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import {
  homeState,
  listeningState,
  startStructureSitting,
  structuresState,
} from "@/lib/ipc";
import { TodayRelief } from "./TodayRelief";
import type { TodayPiece } from "./TodayRelief";
import { todayQueue } from "./todayQueue";
import type { TodayKind } from "./todayQueue";

const ICON: Record<TodayKind, LucideIcon> = {
  words: ListChecks,
  drills: Zap,
  structures: Layers,
};

/** What the day is read from. */
interface Day {
  home: HomeState;
  structures: StructuresState;
  /** Null when the listening could not be read: only its pauses are missing. */
  listening: ListeningState | null;
}

interface LoadedProps {
  day: Day;
  current: Current | null;
  navigate: Navigate;
}

/**
 * The column of glass on the left and the scene of the day on the right, as
 * every place has them; one under the other when the window is narrow.
 */
function Loaded({ day, current, navigate }: LoadedProps): ReactNode {
  const { t } = useTranslation();
  const { home, structures, listening } = day;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The piece a row of the queue points at: it rises in the scene. */
  const [pointed, setPointed] = useState<string | null>(null);

  const dueStructures = structures.structures.filter((each) => each.due);
  const queue = todayQueue({
    words: home.dueWords,
    drills: home.dueReviews,
    structures: dueStructures.length,
  });
  const topic = home.suggestedTopics[0] ?? home.lastSetup?.topic ?? "";
  const name = home.profile.name ?? "";

  const start = (kind: TodayKind): void => {
    if (kind === "words") {
      navigate({ name: "recall", running: "both" });
      return;
    }
    if (kind === "drills") {
      navigate({ name: "practice", patternId: null, format: null });
      return;
    }
    setBusy(true);
    setFailure(null);
    startStructureSitting(
      dueStructures.map((each) => each.key),
      DEFAULT_SIZE,
      null,
    )
      .then((sitting) => {
        navigate({ name: "structures", running: sitting.id });
      })
      .catch((error: unknown) => {
        setFailure(errorMessage(error));
        setBusy(false);
      });
  };
  const openBook = (): void => {
    navigate(
      current === null
        ? { name: "books", bookId: null }
        : { name: "book", tab: nextTab(current.chapter) },
    );
  };
  const talk = (): void => {
    navigate(
      topic === ""
        ? { name: "home" }
        : { name: "conversation", setup: quickSetup(home, topic) },
    );
  };

  const towers: TodayPiece[] = queue.items.map(({ kind, count }) => ({
    key: kind,
    label: String(count),
    count,
    next: queue.next === kind,
    title: t(`today.kind.${kind}.name`),
    lines: [
      count > 0
        ? t(`today.kind.${kind}.count`, { count })
        : t("today.kind.nothing"),
      t(`today.kind.${kind}.from`),
    ],
    onPick: () => {
      start(kind);
    },
  }));
  const places: TodayPiece[] = [
    {
      key: "book",
      label: t("nav.places.book"),
      count: null,
      look: "book",
      title:
        current === null
          ? t("nav.places.book")
          : chapterName(current.chapter, t),
      lines: [
        current === null
          ? t("today.book.none")
          : t(`today.book.next.${nextTab(current.chapter)}`),
      ],
      onPick: openBook,
    },
    {
      key: "talk",
      label: t("nav.places.talk"),
      count: null,
      title: t("home.topicLabel"),
      lines: [topic === "" ? t("today.talk.open") : topic],
      onPick: talk,
    },
  ];
  const paused = [
    ...structures.paused.map((each) => ({
      key: `structures-${each.id}`,
      text: t("today.paused.structures", {
        done: each.done,
        total: each.total,
      }),
      go: (): void => {
        navigate({ name: "structures", running: each.id });
      },
    })),
    ...(listening?.paused ?? []).map((each) => ({
      key: `dictation-${each.id}`,
      text: t("today.paused.dictation", {
        done: each.done,
        total: each.total,
      }),
      go: (): void => {
        navigate({ name: "listening", running: each.id });
      },
    })),
  ];

  return (
    <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row">
      <Stagger className="scrollbar-none flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md wide:overflow-y-auto wide:pb-2">
        <Reveal className="grid grid-cols-2 gap-3">
          <StatTile
            icon={<CalendarCheck aria-hidden className="size-6 text-tally" />}
            label={t("today.tiles.due")}
            value={queue.total}
          />
          <StatTile
            icon={<Flame aria-hidden className="size-6 text-accent-text" />}
            label={t("today.tiles.streak")}
            value={home.streak.days}
          />
        </Reveal>
        <Reveal
          as="section"
          aria-label={t("today.review.title")}
          className="flex flex-col gap-4 rounded-xl glass p-5"
        >
          <header className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-medium tracking-tight text-ink">
              {t("today.review.title")}
            </h2>
            <p className="text-sm text-ink-soft">
              {queue.total > 0
                ? t("today.review.all", { count: queue.total })
                : t("today.review.none")}
            </p>
          </header>
          <Magnetic className="self-start">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                start(queue.next ?? "drills");
              }}
            >
              {queue.next === null
                ? t("today.review.extra")
                : t("today.review.start", {
                    kind: t(`today.kind.${queue.next}.name`),
                  })}
            </Button>
          </Magnetic>
          <ul className="flex flex-col divide-y divide-line">
            {queue.items.map(({ kind, count }) => {
              const Icon = ICON[kind];
              return (
                <li key={kind}>
                  <button
                    type="button"
                    disabled={busy || count === 0}
                    aria-label={`${t(`today.kind.${kind}.name`)}: ${
                      count > 0
                        ? t(`today.kind.${kind}.count`, { count })
                        : t("today.kind.nothing")
                    }`}
                    onClick={() => {
                      start(kind);
                    }}
                    onPointerEnter={() => {
                      setPointed(kind);
                    }}
                    onPointerLeave={() => {
                      setPointed(null);
                    }}
                    onFocus={() => {
                      setPointed(kind);
                    }}
                    onBlur={() => {
                      setPointed(null);
                    }}
                    className="group flex w-full items-center gap-3.5 py-3 text-left transition-control disabled:cursor-default"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sunken text-ink-soft">
                      <Icon
                        aria-hidden
                        className="size-4 transition-transform duration-300 ease-out-expo group-enabled:group-hover:scale-115 group-enabled:group-hover:-rotate-6"
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2 font-medium text-ink">
                        {t(`today.kind.${kind}.name`)}
                        <span
                          className={cn(
                            "rounded-full px-1.5 font-mono text-xs font-semibold",
                            count > 0
                              ? "bg-tally-soft text-tally"
                              : "bg-sunken text-ink-faint",
                          )}
                        >
                          {count}
                        </span>
                      </span>
                      <span className="text-sm text-ink-faint">
                        {t(`today.kind.${kind}.from`)}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-ink-faint transition-transform duration-300 ease-out-expo group-enabled:group-hover:translate-x-1"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
          <Presence>
            {failure !== null && (
              <Notice key="failure" tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            )}
          </Presence>
        </Reveal>
        <Presence>
          {paused.length > 0 && (
            <Reveal
              key="paused"
              as="section"
              aria-label={t("today.paused.title")}
              className="flex flex-col gap-2 rounded-xl glass p-5"
            >
              <h2 className="font-display font-medium tracking-tight text-ink">
                {t("today.paused.title")}
              </h2>
              <ul className="flex flex-col divide-y divide-line">
                {paused.map((each) => (
                  <li
                    key={each.key}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <span className="text-sm text-ink-soft tabular-nums">
                      {each.text}
                    </span>
                    <Button size="sm" onClick={each.go}>
                      {t("today.paused.continue")}
                    </Button>
                  </li>
                ))}
              </ul>
            </Reveal>
          )}
        </Presence>
      </Stagger>
      <Stagger className="flex min-h-160 min-w-0 flex-1 flex-col">
        <Scene
          label={t("today.scene")}
          zoom
          className="flex-1"
          header={
            <>
              <SceneTitle>
                {name === ""
                  ? t("home.greetingAnon")
                  : t("home.greeting", { name })}
              </SceneTitle>
              <div className="flex flex-wrap items-center gap-2.5">
                <StatChip value={queue.total} tone="accent">
                  {t("today.chips.due", { count: queue.total })}
                </StatChip>
                <StatChip value={home.streak.days}>
                  {t("today.chips.streak", { count: home.streak.days })}
                </StatChip>
              </div>
            </>
          }
          footer={
            <Reveal className="grid gap-x-8 gap-y-5 rounded-xl glass px-5.5 py-4.5 wide:grid-cols-2">
              <div className="flex min-w-0 flex-col items-start gap-2">
                <span className="font-mono text-xs tracking-wider text-book uppercase">
                  {t("today.book.label")}
                </span>
                <span className="line-clamp-2 font-display text-xl font-medium tracking-tight text-ink">
                  {current === null
                    ? t("today.book.none")
                    : chapterName(current.chapter, t)}
                </span>
                <Presence>
                  {current !== null && (
                    <Reveal
                      key="next"
                      as="span"
                      kind="fade"
                      className="text-sm text-ink-soft"
                    >
                      {t(`today.book.next.${nextTab(current.chapter)}`)}
                    </Reveal>
                  )}
                </Presence>
                <Magnetic>
                  <Button variant="primaryBook" onClick={openBook}>
                    {current === null
                      ? t("today.book.add")
                      : t("today.book.open")}
                  </Button>
                </Magnetic>
              </div>
              <div className="flex min-w-0 flex-col items-start gap-2 wide:border-l wide:border-line wide:pl-8">
                <span className="font-mono text-xs tracking-wider text-partner uppercase">
                  {t("today.talk.label")}
                </span>
                <span className="line-clamp-2 font-display text-xl font-medium tracking-tight text-ink">
                  {topic === "" ? t("today.talk.open") : topic}
                </span>
                <Presence>
                  {home.focus !== null && (
                    <Reveal
                      key="focus"
                      as="span"
                      kind="fade"
                      className="line-clamp-2 text-sm text-ink-soft"
                    >
                      {t("today.talk.focus", {
                        pattern: home.focus.description,
                      })}
                    </Reveal>
                  )}
                </Presence>
                <Magnetic>
                  <Button
                    variant="primary"
                    className="group"
                    icon={
                      <Mic
                        aria-hidden
                        className="size-4 transition-transform duration-300 ease-out-expo group-hover:scale-110"
                      />
                    }
                    onClick={talk}
                  >
                    {t("home.start")}
                  </Button>
                </Magnetic>
              </div>
            </Reveal>
          }
        >
          <TodayRelief
            towers={towers}
            places={places}
            pointed={pointed}
            label={t("today.relief")}
            className="size-full max-w-4xl px-6 pt-32 pb-56"
          />
        </Scene>
      </Stagger>
    </div>
  );
}

interface TodayProps {
  /** The chapter the learner is on, to go on with. */
  current: Current | null;
  navigate: Navigate;
}

/**
 * Where the app opens: everything that comes back today as one queue, the
 * daily review, each kind saying where it comes from; what was left
 * unfinished; and the next step in the book and in the conversation. The
 * scene raises the day as a relief, a tower for each kind of the review.
 */
export function Today({ current, navigate }: TodayProps): ReactNode {
  const { t } = useTranslation();
  const [day, setDay] = useState<Day | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const chapterId = current?.chapter.id ?? null;

  useEffect(() => {
    let live = true;
    Promise.all([
      homeState(),
      structuresState(),
      // The pauses of the listening are an extra: the day stands without.
      listeningState(chapterId).catch(() => null),
    ])
      .then(([home, structures, listening]) => {
        if (live) {
          setDay({ home, structures, listening });
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
  }, [chapterId]);

  return (
    <Presence swap>
      {day === null ? (
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
          <Loaded day={day} current={current} navigate={navigate} />
        </Reveal>
      )}
    </Presence>
  );
}
