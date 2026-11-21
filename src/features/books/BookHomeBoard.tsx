import { motion, useReducedMotionConfig } from "motion/react";
import { ArrowRight, ArrowUpRight, CircleCheck, SquareDot } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Swap } from "@/components/motion/Swap";
import { project } from "@/components/scene/iso";
import { MetricCard } from "@/components/scene/MetricCard";
import { Block } from "@/components/scene/Relief";
import { BigNumber, StatChip, StatTile } from "@/components/scene/Stats";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { EASE_OUT, animated, staggerDelay } from "@/lib/motion";
import { Translate } from "./BookHomePanels";
import { barState, chapterWindow } from "./chapterChart";
import type { BarState } from "./chapterChart";
import { chapterName, chapterPlaceName } from "./chapterName";

/** How many chapters the chart has room for. */
export const BARS = 12;

const FILL: Record<BarState, string> = {
  ready: "bg-book",
  learning: "bg-accent/60",
  unprepared: "",
};

const SWATCH: Record<BarState, string> = {
  ready: "bg-book",
  learning: "bg-accent",
  unprepared: "bg-line-strong",
};

const PILL: Record<BarState, string> = {
  ready: "border-book/40 bg-book-soft text-book-ink",
  learning: "border-accent bg-accent text-on-accent",
  unprepared: "border-line-strong text-ink-soft",
};

interface ChartProps {
  book: Book;
  selected: Chapter;
  onSelect: (chapter: Chapter) => void;
}

/** The chapters around the picked one, each a bar filled as far as it is ready. */
function Chart({ book, selected, onSelect }: ChartProps): ReactNode {
  const { t } = useTranslation();
  const reduced = useReducedMotionConfig() === true;
  const shown = chapterWindow(book.chapters, selected.id, BARS);
  return (
    <div className="flex gap-2 pt-2">
      <div className="relative flex flex-1 gap-1.5">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-28 border-t border-dashed border-ink/45"
        />
        <span
          aria-hidden
          className="absolute inset-x-0 top-14 border-t border-ink/10"
        />
        {shown.map((chapter, index) => {
          const state = barState(chapter);
          const on = chapter.id === selected.id;
          return (
            <button
              key={chapter.id}
              type="button"
              aria-pressed={on}
              aria-label={t(`bookHome.bar.${state}`, {
                chapter: chapterName(chapter, t),
                words: chapter.words,
                readiness: chapter.readiness ?? 0,
              })}
              onClick={() => {
                onSelect(chapter);
              }}
              className="group relative flex min-w-0 flex-1 flex-col items-center gap-2"
            >
              <span className="flex h-28 w-full items-end">
                <span
                  className={cn(
                    "relative w-full",
                    state === "unprepared" ? "h-2" : "h-full",
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
                        className="absolute -inset-1 rounded-md outline-1 outline-ink"
                      />
                    )}
                  </Presence>
                  <motion.span
                    initial={animated() && !reduced ? { scaleY: 0 } : false}
                    animate={{ scaleY: 1 }}
                    transition={{
                      duration: 0.7,
                      ease: EASE_OUT,
                      delay: staggerDelay(index),
                    }}
                    className={cn(
                      "relative block size-full origin-bottom overflow-hidden rounded-sm transition-control",
                      state === "unprepared" ? "bg-line-strong" : "bg-raised",
                      !on &&
                        "group-hover:outline-1 group-hover:outline-offset-2 group-hover:outline-line-strong",
                    )}
                  >
                    <motion.span
                      initial={false}
                      animate={{ height: `${String(chapter.readiness ?? 0)}%` }}
                      transition={{ duration: 0.5, ease: EASE_OUT }}
                      className={cn(
                        "absolute inset-x-0 bottom-0 rounded-sm",
                        on && state === "learning" ? "bg-accent" : FILL[state],
                      )}
                    />
                  </motion.span>
                </span>
              </span>
              <span
                className={cn(
                  "font-mono text-xs transition-control",
                  on ? "text-ink" : "text-ink-faint group-hover:text-ink-soft",
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
        className="relative w-9 shrink-0 font-mono text-xs text-ink-faint"
      >
        <span className="absolute top-0 -translate-y-1/2">100%</span>
        <span className="absolute top-14 -translate-y-1/2">50%</span>
      </span>
    </div>
  );
}

function Legend(): ReactNode {
  const { t } = useTranslation();
  const keys: BarState[] = ["ready", "learning", "unprepared"];
  return (
    <ul className="flex flex-wrap gap-4 pt-1 text-xs text-ink-faint">
      {keys.map((key) => (
        <li key={key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-2 rounded-full", SWATCH[key])}
          />
          {t(`bookHome.legend.${key}`)}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the drawing on a chapter's card takes up, from the top of its tallest
 * block (30 high, standing 4 up) to the near corner of its base, with a
 * margin: the box is fixed so that the block grows inside it.
 */
const PLINTH_VIEW = (() => {
  const margin = 6;
  const [left] = project(0, 64);
  const [right] = project(64, 0);
  const [, top] = project(10, 10, 4 + 30);
  const [, bottom] = project(64, 64);
  return [
    left - margin,
    top - margin,
    right - left + margin * 2,
    bottom - top + margin * 2,
  ].join(" ");
})();

/** A chapter's block, as tall as it is ready: the drawing on its card. */
export function Plinth({
  chapter,
  lit,
}: {
  chapter: Chapter;
  lit: boolean;
}): ReactNode {
  const h = chapter.readiness === null ? 4 : 6 + chapter.readiness * 0.24;
  return (
    <svg viewBox={PLINTH_VIEW} className="h-16 w-full" aria-hidden>
      <Block x={0} y={0} w={64} d={64} h={4} />
      <Block
        x={10}
        y={10}
        w={44}
        d={44}
        h={h}
        z={4}
        look={lit ? "lit" : barState(chapter) === "ready" ? "book" : "plain"}
      />
    </svg>
  );
}

interface SelectedProps {
  book: Book;
  chapter: Chapter;
  navigate: Navigate;
}

/** The picked chapter: where its words stand, and the way into them. */
function Selected({ book, chapter, navigate }: SelectedProps): ReactNode {
  const { t } = useTranslation();
  const state = barState(chapter);
  return (
    <div className="flex flex-col gap-2.5 rounded-xl glass p-4 outline-1 -outline-offset-1 outline-accent/45">
      <span className="flex items-start justify-between gap-2">
        <span className="relative min-w-0 flex-1">
          <Swap
            id={chapter.id}
            as="div"
            className="font-display text-base font-semibold tracking-tight text-ink"
          >
            {chapterPlaceName(chapter, t)}
          </Swap>
        </span>
        <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
      </span>
      <Presence swap>
        {chapter.title !== "" && (
          <Reveal
            key={chapter.id}
            as="span"
            kind="fade"
            className="line-clamp-2 font-mono text-xs text-ink-faint"
          >
            {chapter.title}
          </Reveal>
        )}
      </Presence>
      <Plinth chapter={chapter} lit />
      <span
        className={cn(
          "relative mt-1 self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-control",
          PILL[state],
        )}
      >
        <Swap id={state + String(chapter.readiness ?? 0)}>
          {t(`bookHome.state.${state}`, { readiness: chapter.readiness ?? 0 })}
        </Swap>
      </span>
      <button
        type="button"
        onClick={() => {
          navigate({ name: "books", bookId: book.id, chapterId: chapter.id });
        }}
        className="group inline-flex items-center gap-1 self-start text-sm font-semibold text-accent-text"
      >
        {t(state === "unprepared" ? "bookHome.prepare" : "bookHome.study")}
        <ArrowRight
          aria-hidden
          className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-1"
        />
      </button>
    </div>
  );
}

interface BookBoardProps {
  book: Book;
  selected: Chapter;
  /** Every word the learner has, learned here or known before. */
  words: number;
  nativeLang: string;
  navigate: Navigate;
  onPick: (chapterId: string) => void;
}

/**
 * The column of glass beside the scene: the book in counts, how ready each
 * chapter is with the picked one in big, and the ways into it.
 */
export function BookBoard({
  book,
  selected,
  words,
  nativeLang,
  navigate,
  onPick,
}: BookBoardProps): ReactNode {
  const { t } = useTranslation();
  const states = book.chapters.map(barState);
  const ready = states.filter((state) => state === "ready").length;
  const learning = states.filter((state) => state === "learning").length;
  const name = chapterName(selected, t);
  return (
    <Stagger className="flex flex-col gap-3.5">
      <Reveal className="flex flex-wrap gap-2">
        <StatChip value={book.chapters.length}>
          {t("bookHome.board.chapters", { count: book.chapters.length })}
        </StatChip>
        <StatChip value={words}>
          {t("bookHome.board.words", { count: words })}
        </StatChip>
        <StatChip value={ready} tone="accent">
          {t("bookHome.board.ready", { count: ready })}
        </StatChip>
      </Reveal>
      <Reveal className="grid grid-cols-2 gap-3">
        <StatTile
          icon={<CircleCheck aria-hidden className="size-6 text-book" />}
          label={t("bookHome.legend.ready")}
          value={ready}
        />
        <StatTile
          icon={<SquareDot aria-hidden className="size-6 text-accent-text" />}
          label={t("bookHome.legend.learning")}
          value={learning}
        />
      </Reveal>
      <Reveal
        as="section"
        aria-label={t("bookHome.chapters.title")}
        className="flex flex-col gap-3.5"
      >
        <MetricCard
          title={t("bookHome.chapters.title")}
          number={
            <BigNumber value={selected.readiness ?? 0} unit="%" size="xl" />
          }
          note={
            <span className="relative block">
              <Swap id={selected.id} as="div">
                {selected.readiness === null
                  ? t("bookHome.board.noteNone", { chapter: name })
                  : t("bookHome.board.note", { chapter: name })}
              </Swap>
            </span>
          }
        >
          <Chart
            book={book}
            selected={selected}
            onSelect={(chapter) => {
              onPick(chapter.id);
            }}
          />
          <Legend />
        </MetricCard>
        <div className="grid grid-cols-2 gap-3">
          <Selected book={book} chapter={selected} navigate={navigate} />
          <Translate
            book={book}
            chapter={selected}
            nativeLang={nativeLang}
            navigate={navigate}
          />
        </div>
      </Reveal>
    </Stagger>
  );
}
