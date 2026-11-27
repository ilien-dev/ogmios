import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import type {
  ChapterStrength,
  BookReviews,
  KindCount,
  LearningPace,
} from "@shared/board";
import type { Navigate } from "@/app/routes";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Swap } from "@/components/motion/Swap";
import { StatChip } from "@/components/scene/Stats";
import {
  bookDue,
  bookStrengths,
  chapterKindCounts,
  learningPace,
} from "@/lib/ipc";
import { cn } from "@/lib/cn";
import { EASE_OUT, animated, staggerDelay } from "@/lib/motion";
import { barState, chapterTop, chapterWindow } from "./chapterChart";
import { kindTallies } from "./chapterKinds";
import type { KindGroup } from "./chapterKinds";
import { chapterName } from "./chapterName";

/** How many chapters the chart has room for. */
export const BARS = 12;

/** The strengths a bar stacks, from its foot up, with their colour. */
const LAYERS = [
  { key: "fresh", fill: "bg-accent/25" },
  { key: "settling", fill: "bg-accent/55" },
  { key: "firm", fill: "bg-accent" },
] as const;

type Strengths = ReadonlyMap<string, ChapterStrength>;

function learnedIn(strength: ChapterStrength | undefined): number {
  return strength === undefined
    ? 0
    : strength.fresh + strength.settling + strength.firm;
}

interface ChartProps {
  book: Book;
  selected: Chapter;
  strengths: Strengths;
  onSelect: (chapter: Chapter) => void;
}

/**
 * The chapters around the picked one, each a bar as tall as the words
 * learned in it, stacked by how strong they are: new at its foot, firm on
 * top. A chapter not prepared is a stub. Each bar picks its chapter.
 */
function Chart({ book, selected, strengths, onSelect }: ChartProps): ReactNode {
  const { t } = useTranslation();
  const reduced = useReducedMotionConfig() === true;
  const shown = chapterWindow(book.chapters, selected.id, BARS);
  const top = chapterTop(
    Math.max(0, ...shown.map((each) => learnedIn(strengths.get(each.id)))),
  );
  return (
    <div className="flex min-h-0 flex-1 gap-2">
      <div className="relative flex flex-1 items-end gap-1.5">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 border-t border-dashed border-ink/30"
        />
        {shown.map((chapter, index) => {
          const strength = strengths.get(chapter.id);
          const learned = learnedIn(strength);
          const on = chapter.id === selected.id;
          const unprepared = barState(chapter) === "unprepared";
          return (
            <button
              key={chapter.id}
              type="button"
              aria-pressed={on}
              aria-label={
                unprepared
                  ? t("bookHome.bar.unprepared", {
                      chapter: chapterName(chapter, t),
                    })
                  : t("bookHome.bar.strength", {
                      chapter: chapterName(chapter, t),
                      firm: strength?.firm ?? 0,
                      settling: strength?.settling ?? 0,
                      fresh: strength?.fresh ?? 0,
                    })
              }
              onClick={() => {
                onSelect(chapter);
              }}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5"
            >
              <span className="relative flex min-h-0 flex-1 items-end">
                <motion.span
                  initial={animated() && !reduced ? { scaleY: 0 } : false}
                  animate={{
                    scaleY: 1,
                    height:
                      learned === 0
                        ? "0.25rem"
                        : `${String((learned / top) * 100)}%`,
                  }}
                  transition={{
                    duration: 0.6,
                    ease: EASE_OUT,
                    delay: staggerDelay(index),
                  }}
                  className={cn(
                    "relative flex w-full origin-bottom flex-col-reverse gap-0.5 rounded-sm transition-control",
                    learned === 0 && "bg-line-strong",
                    !on &&
                      "group-hover:outline-1 group-hover:outline-offset-2 group-hover:outline-line-strong",
                  )}
                >
                  <Presence>
                    {on && (
                      <motion.span
                        key="ring"
                        layoutId="book-home-picked-bar"
                        aria-hidden
                        transition={{
                          type: "spring",
                          stiffness: 380,
                          damping: 32,
                        }}
                        className="absolute -inset-1 rounded-md outline-2 outline-ink"
                      />
                    )}
                  </Presence>
                  {LAYERS.map((layer) => {
                    const count = strength?.[layer.key] ?? 0;
                    return (
                      <motion.span
                        key={layer.key}
                        aria-hidden
                        initial={false}
                        animate={{ flexGrow: count }}
                        transition={{ duration: 0.5, ease: EASE_OUT }}
                        className={cn(
                          "block min-h-0 basis-0 rounded-xs",
                          layer.fill,
                        )}
                      />
                    );
                  })}
                </motion.span>
              </span>
              <span
                className={cn(
                  "text-center font-mono text-xs transition-control",
                  on
                    ? "font-semibold text-ink"
                    : "text-ink-faint group-hover:text-ink-soft",
                )}
              >
                {chapter.index + 1}
              </span>
            </button>
          );
        })}
      </div>
      <span
        aria-hidden
        className="flex shrink-0 flex-col justify-between pb-6 font-mono text-xs text-ink-faint"
      >
        <span>{top}</span>
        <span>{top / 2}</span>
        <span>0</span>
      </span>
    </div>
  );
}

function Legend(): ReactNode {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-soft">
      {[...LAYERS].reverse().map((layer) => (
        <li key={layer.key} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 rounded-xs", layer.fill)} />
          {t(`bookHome.legend.${layer.key}`)}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-0.5 w-2.5 bg-line-strong" />
        {t("bookHome.legend.unprepared")}
      </li>
    </ul>
  );
}

/** How strong the learned words of each chapter of the book are; null until read. */
function useStrengths(book: Book): Strengths | null {
  const [strengths, setStrengths] = useState<Strengths | null>(null);
  useEffect(() => {
    let live = true;
    void bookStrengths(book.id).then((found) => {
      if (live) {
        setStrengths(new Map(found.map((each) => [each.chapterId, each])));
      }
    });
    return () => {
      live = false;
    };
  }, [book]);
  return strengths;
}

interface StrengthCardProps {
  book: Book;
  selected: Chapter;
  onPick: (chapterId: string) => void;
}

/**
 * How firm the words learned so far are, chapter by chapter, with the
 * picked chapter's firm words in big.
 */
function StrengthCard({
  book,
  selected,
  onPick,
}: StrengthCardProps): ReactNode {
  const { t } = useTranslation();
  const strengths = useStrengths(book);
  const picked = strengths?.get(selected.id);
  const title = t("bookHome.chapters.title");
  return (
    <section
      aria-label={title}
      className="flex h-82 flex-col gap-3 rounded-xl glass px-5.5 py-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-medium text-ink">{title}</h3>
          <p className="text-sm text-ink-soft">{t("bookHome.chapters.hint")}</p>
        </div>
        <Presence>
          {strengths !== null && (
            <Reveal
              key="firm"
              kind="fade"
              className="flex shrink-0 items-baseline gap-1.5"
            >
              <CountUp
                value={picked?.firm ?? 0}
                from={0}
                className="font-display text-4xl leading-none font-light tabular-nums"
              />
              <span className="text-sm text-ink-soft">
                {t("bookHome.chapters.firm", { count: learnedIn(picked) })}
              </span>
            </Reveal>
          )}
        </Presence>
      </header>
      <Presence swap>
        {strengths !== null && (
          <Reveal key="chart" kind="fade" className="flex min-h-0 flex-1">
            <Chart
              book={book}
              selected={selected}
              strengths={strengths}
              onSelect={(chapter) => {
                onPick(chapter.id);
              }}
            />
          </Reveal>
        )}
      </Presence>
      <Legend />
    </section>
  );
}

/** How many of the book's words the daily review asks today; null until read. */
function useReviews(book: Book): BookReviews | null {
  const [reviews, setReviews] = useState<BookReviews | null>(null);
  useEffect(() => {
    let live = true;
    void bookDue(book.id).then((found) => {
      if (live) {
        setReviews(found);
      }
    });
    return () => {
      live = false;
    };
  }, [book]);
  return reviews;
}

interface ReviewsCardProps {
  reviews: BookReviews;
  /** Everything that comes back today. */
  todayDue: number;
  navigate: Navigate;
}

/**
 * How many words of this book the daily review asks today, of all it asks,
 * with the way into it.
 */
function ReviewsCard({
  reviews,
  todayDue,
  navigate,
}: ReviewsCardProps): ReactNode {
  const { t } = useTranslation();
  const waiting = reviews.due > 0;
  const label = t("bookHome.reviews.count", { count: reviews.due });
  return (
    <section
      aria-label={`${String(reviews.due)} ${label}`}
      className="flex items-center gap-4 rounded-xl glass px-4.5 py-4"
    >
      <CountUp
        value={reviews.due}
        from={0}
        className="font-display text-4xl leading-none font-light text-tally tabular-nums"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="relative text-xs text-ink-soft">
          <Swap id={waiting ? "of" : "none"} as="div">
            {waiting
              ? t("bookHome.reviews.of", {
                  total: Math.max(todayDue, reviews.due),
                  minutes: reviews.minutes,
                })
              : t("bookHome.reviews.none")}
          </Swap>
        </span>
      </div>
      <Presence>
        {waiting && (
          <Reveal key="start" as="span" kind="scale" className="shrink-0">
            <button
              type="button"
              onClick={() => {
                navigate({ name: "recall", running: null });
              }}
              className="h-11 rounded-full bg-tally-soft px-4.5 text-sm font-semibold text-tally transition-control hover:bg-tally-fill/50 focus-visible:bg-tally-fill/50"
            >
              {t("bookHome.reviews.start")}
            </button>
          </Reveal>
        )}
      </Presence>
    </section>
  );
}

/** The colour of each group of kinds, as the words' tags have it. */
const KIND_FILL: Record<KindGroup, string> = {
  noun: "bg-noun",
  verb: "bg-verb",
  adjective: "bg-adjective",
  adverb: "bg-adverb",
  expression: "bg-expression",
  other: "bg-line-strong",
};

/** A chapter's words by kind; null until read, and for another chapter. */
function useKinds(book: Book, chapter: Chapter): readonly KindCount[] | null {
  const [kinds, setKinds] = useState<{
    id: string;
    counts: readonly KindCount[];
  } | null>(null);
  useEffect(() => {
    let live = true;
    void chapterKindCounts(chapter.id).then((counts) => {
      if (live) {
        setKinds({ id: chapter.id, counts });
      }
    });
    return () => {
      live = false;
    };
  }, [book, chapter.id]);
  return kinds?.id === chapter.id ? kinds.counts : null;
}

interface KindsCardProps {
  chapter: Chapter;
  counts: readonly KindCount[];
}

/**
 * The picked chapter's words by kind: a bar split by how many each kind
 * has, and each kind with how many of its words are learned.
 */
function KindsCard({ chapter, counts }: KindsCardProps): ReactNode {
  const { t } = useTranslation();
  const tallies = kindTallies(counts);
  const title = t("bookHome.kinds.title", { number: chapter.index + 1 });
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl glass px-5.5 py-4.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-xs font-semibold tracking-wider text-ink-soft uppercase">
          {title}
        </h3>
        <span className="text-xs text-ink-faint">
          {t("bookHome.kinds.scale")}
        </span>
      </div>
      <div
        aria-hidden
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      >
        {tallies.map((tally) => (
          <motion.span
            key={tally.group}
            initial={false}
            animate={{ flexGrow: tally.total }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
            className={cn("block basis-0", KIND_FILL[tally.group])}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-5 gap-y-1.5">
        {tallies.map((tally) => (
          <li key={tally.group} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                KIND_FILL[tally.group],
              )}
            />
            <span className="min-w-0 flex-1 truncate text-ink">
              {t(`bookHome.kinds.${tally.group}`)}
            </span>
            <span className="font-mono text-xs text-ink-soft tabular-nums">
              {t("bookHome.kinds.count", {
                learned: tally.learned,
                total: tally.total,
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The learner's pace and the picked chapter's days left; null until read. */
function usePace(book: Book, chapter: Chapter): LearningPace | null {
  const [pace, setPace] = useState<{ id: string; pace: LearningPace } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    void learningPace(chapter.id).then((found) => {
      if (live) {
        setPace({ id: chapter.id, pace: found });
      }
    });
    return () => {
      live = false;
    };
  }, [book, chapter.id]);
  return pace?.id === chapter.id ? pace.pace : null;
}

/** The sparkline's box. */
const LINE_W = 120;
const LINE_H = 40;

/** The words learned day by day, as a thin line that draws itself in. */
function Sparkline({ daily }: { daily: readonly number[] }): ReactNode {
  const { t } = useTranslation();
  const reduced = useReducedMotionConfig() === true;
  const top = Math.max(1, ...daily);
  const step = LINE_W / Math.max(1, daily.length - 1);
  const points = daily
    .map((count, day) => {
      const x = day * step;
      const y = LINE_H - 4 - (count / top) * (LINE_H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${String(LINE_W)} ${String(LINE_H)}`}
      role="img"
      aria-label={t("bookHome.pace.line", { count: daily.length })}
      className="h-10 w-30 shrink-0 overflow-visible"
    >
      <motion.polyline
        points={points}
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-accent"
        initial={animated() && !reduced ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: EASE_OUT }}
      />
    </svg>
  );
}

interface PaceCardProps {
  chapter: Chapter;
  pace: LearningPace;
}

/**
 * At the learner's pace, about how many days until the picked chapter can be
 * read, with the words learned day by day over the last two weeks.
 */
function PaceCard({ chapter, pace }: PaceCardProps): ReactNode {
  const { t } = useTranslation();
  const name = chapterName(chapter, t);
  const learned = pace.daily.reduce((all, day) => all + day, 0);
  const perDay = learned / Math.max(1, pace.daily.length);
  let state = "pace";
  if (pace.days === 0) {
    state = "ready";
  } else if (pace.days === null) {
    state = "none";
  }
  return (
    <section
      aria-label={t("bookHome.pace.title")}
      className="flex flex-col gap-2.5 rounded-xl glass px-5.5 py-4.5"
    >
      <h3 className="font-mono text-xs font-semibold tracking-wider text-ink-soft uppercase">
        {t("bookHome.pace.title")}
      </h3>
      <div className="flex items-center gap-4">
        <span className="relative font-display text-4xl leading-none font-light tabular-nums">
          <Swap id={`${state}-${String(pace.days)}`} as="div">
            {pace.days === null ? "–" : `~${String(pace.days)}`}
          </Swap>
        </span>
        <div className="relative min-w-0 flex-1 text-sm leading-snug text-ink">
          <Swap id={`${state}-${chapter.id}`} as="div">
            {state === "pace" && (
              <>
                {t("bookHome.pace.days", { count: pace.days ?? 0 })}{" "}
                <b className="font-semibold">{name}</b>
              </>
            )}
            {state === "ready" && t("bookHome.pace.ready", { chapter: name })}
            {state === "none" && t("bookHome.pace.none", { chapter: name })}
          </Swap>
        </div>
        <Sparkline daily={pace.daily} />
      </div>
      <p className="text-xs text-ink-soft">
        {t("bookHome.pace.mean", {
          count: perDay >= 10 ? Math.round(perDay) : Number(perDay.toFixed(1)),
          days: pace.daily.length,
        })}
      </p>
    </section>
  );
}

interface BookBoardProps {
  book: Book;
  /** The chapter the learner is on. */
  selected: Chapter;
  /** Everything that comes back today, the count beside Today. */
  todayDue: number;
  navigate: Navigate;
  /** Makes a chapter the one the learner is on. */
  onPick: (chapterId: string) => void;
}

/**
 * The column of glass beside the scene: the book in counts, how firm what
 * was learned in each chapter is, what of it the daily review asks today,
 * the picked chapter's words by kind, and how long until it can be read. A bar picks a chapter, as a block of
 * the scene and the list in the chapter's band do.
 */
export function BookBoard({
  book,
  selected,
  todayDue,
  navigate,
  onPick,
}: BookBoardProps): ReactNode {
  const { t } = useTranslation();
  const reviews = useReviews(book);
  const kinds = useKinds(book, selected);
  const pace = usePace(book, selected);
  const states = book.chapters.map(barState);
  const ready = states.filter((state) => state === "ready").length;
  const learning = states.filter((state) => state === "learning").length;
  return (
    <Stagger className="flex flex-col gap-3.5">
      <Reveal className="flex flex-wrap gap-2">
        <StatChip value={book.chapters.length}>
          {t("bookHome.board.chapters", { count: book.chapters.length })}
        </StatChip>
        <StatChip value={ready} tone="book">
          {t("bookHome.board.ready", { count: ready })}
        </StatChip>
        <StatChip value={learning} tone="accent">
          {t("bookHome.board.learning", { count: learning })}
        </StatChip>
      </Reveal>
      <Reveal>
        <StrengthCard book={book} selected={selected} onPick={onPick} />
      </Reveal>
      <Presence>
        {reviews !== null && (
          <Reveal key="reviews">
            <ReviewsCard
              reviews={reviews}
              todayDue={todayDue}
              navigate={navigate}
            />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {kinds !== null && kinds.length > 0 && (
          <Reveal key={`kinds-${selected.id}`} kind="fade">
            <KindsCard chapter={selected} counts={kinds} />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {pace !== null && pace.left !== null && (
          <Reveal key="pace" kind="fade">
            <PaceCard chapter={selected} pace={pace} />
          </Reveal>
        )}
      </Presence>
    </Stagger>
  );
}
