import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import type { ChapterStrength } from "@shared/board";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { StatChip } from "@/components/scene/Stats";
import { bookStrengths } from "@/lib/ipc";
import { cn } from "@/lib/cn";
import { EASE_OUT, animated, staggerDelay } from "@/lib/motion";
import { barState, chapterTop, chapterWindow } from "./chapterChart";
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

interface BookBoardProps {
  book: Book;
  /** The chapter the learner is on. */
  selected: Chapter;
  /** Makes a chapter the one the learner is on. */
  onPick: (chapterId: string) => void;
}

/**
 * The column of glass beside the scene: the book in counts and how firm
 * what was learned in each chapter is. A bar picks a chapter, as a block of
 * the scene and the list in the chapter's band do.
 */
export function BookBoard({
  book,
  selected,
  onPick,
}: BookBoardProps): ReactNode {
  const { t } = useTranslation();
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
    </Stagger>
  );
}
