import { motion, useReducedMotionConfig } from "motion/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Button } from "@/components/ui/Button";
import type { BookTab, Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, animated } from "@/lib/motion";
import { ChapterPicker } from "./ChapterPicker";
import { ChapterTabs } from "./ChapterTabs";
import { chapterName } from "./chapterName";

/** The ring's radius in its 60-unit box, and how long it runs round. */
const RADIUS = 24;
const ROUND = 2 * Math.PI * RADIUS;

/** How ready the chapter is to read, as a ring as full as that. */
function ReadyRing({ readiness }: { readiness: number }): ReactNode {
  const { t } = useTranslation();
  const reduced = useReducedMotionConfig() === true;
  return (
    <svg
      viewBox="0 0 60 60"
      role="img"
      aria-label={t("bookHome.head.ready", { readiness })}
      className="size-15 shrink-0"
    >
      <circle
        cx="30"
        cy="30"
        r={RADIUS}
        fill="none"
        strokeWidth="6"
        className="stroke-surface"
      />
      <motion.circle
        cx="30"
        cy="30"
        r={RADIUS}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={ROUND}
        transform="rotate(-90 30 30)"
        initial={animated() && !reduced ? { strokeDashoffset: ROUND } : false}
        animate={{ strokeDashoffset: ROUND * (1 - readiness / 100) }}
        transition={{ duration: DURATION.enterSlow, ease: EASE_OUT }}
        className="stroke-book"
      />
      <text
        x="30"
        y="35"
        textAnchor="middle"
        className="fill-book-ink font-display text-sm"
      >
        {`${readiness}%`}
      </text>
    </svg>
  );
}

interface ChapterHeadProps {
  book: Book;
  /** The chapter the learner is on: every tab works on it. */
  chapter: Chapter;
  tab: BookTab;
  navigate: Navigate;
  /** Makes a chapter the one the learner is on. */
  onPick: (chapterId: string) => void;
}

/**
 * The top of the chapter's panel: the four tabs, and under them the chapter
 * every tab works on, in a band of the book's colour with its place in the
 * book, how ready it is, the way to the chapter before or after, and beside
 * its name the list of every other (also on Ctrl+K or ⌘K). It stays
 * while the tab changes; only what names the chapter cross-fades when
 * another is picked.
 */
export function ChapterHead({
  book,
  chapter,
  tab,
  navigate,
  onPick,
}: ChapterHeadProps): ReactNode {
  const { t } = useTranslation();
  const at = book.chapters.findIndex((each) => each.id === chapter.id);
  const before = book.chapters[at - 1];
  const after = book.chapters[at + 1];
  const number = at + 1;
  const [picking, setPicking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const stopPicking = useCallback(() => {
    setPicking(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const asked =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k";
      // Over a dialog the app is inert: the list waits until it closes.
      const covered = document.getElementById("root")?.hasAttribute("inert");
      if (!asked || event.repeat || covered === true) {
        return;
      }
      event.preventDefault();
      setPicking(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <ChapterTabs chapter={chapter} tab={tab} navigate={navigate} />
      <Reveal className="flex items-center gap-5 rounded-2xl border border-book/20 bg-book-soft py-4 pr-4 pl-6">
        <span
          aria-hidden
          className="relative font-display text-display font-light text-book tabular-nums"
        >
          <Swap id={chapter.id}>{String(number).padStart(2, "0")}</Swap>
        </span>
        <div className="relative flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate font-mono text-xs font-semibold tracking-wider text-book uppercase">
            {t("bookHome.head.of", {
              number,
              total: book.chapters.length,
              book: book.title,
            })}
          </p>
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="relative min-w-0 font-display text-title tracking-tight text-book-ink">
              <Swap id={chapter.id} as="div">
                {chapterName(chapter, t)}
              </Swap>
            </h2>
            <button
              ref={opener}
              type="button"
              aria-label={t("bookHome.head.choose")}
              aria-haspopup="dialog"
              aria-expanded={picking}
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => {
                setPicking((open) => !open);
              }}
              className={cn(
                "relative flex size-8 shrink-0 items-center justify-center rounded-full transition-control before:absolute before:-inset-1.5",
                picking
                  ? "bg-book text-surface"
                  : "text-book hover:bg-book/10 focus-visible:bg-book/10",
              )}
            >
              <motion.span
                aria-hidden
                initial={false}
                animate={{ rotate: picking ? 180 : 0 }}
                transition={{ duration: DURATION.enter, ease: EASE_OUT }}
                className="flex"
              >
                <ChevronDown className="size-4.5" />
              </motion.span>
            </button>
          </div>
          <Presence>
            {picking && (
              <Reveal
                key="picker"
                kind="scale"
                className="absolute top-full left-0 z-30 mt-3 w-full max-w-md origin-top"
              >
                <ChapterPicker
                  book={book}
                  current={chapter}
                  opener={opener}
                  onClose={stopPicking}
                  onPick={onPick}
                />
              </Reveal>
            )}
          </Presence>
          <Presence>
            {after !== undefined && (
              <Reveal
                key="next"
                kind="fade"
                className="relative truncate text-sm text-book-ink"
              >
                <Swap id={after.id} as="div" className="truncate">
                  {t("bookHome.board.next", {
                    chapter: chapterName(after, t),
                  })}
                </Swap>
              </Reveal>
            )}
          </Presence>
        </div>
        <Presence>
          {chapter.readiness !== null && (
            <Reveal key="ready" kind="scale" className="hidden @md:block">
              <ReadyRing readiness={chapter.readiness} />
            </Reveal>
          )}
        </Presence>
        <div className="flex flex-col gap-1.5">
          <Button
            size="sm"
            className="size-11 px-0 text-book"
            aria-label={t("bookHome.head.previous")}
            disabled={before === undefined}
            icon={<ChevronUp aria-hidden className="size-4" />}
            onClick={() => {
              if (before !== undefined) {
                onPick(before.id);
              }
            }}
          />
          <Button
            size="sm"
            className="size-11 px-0 text-book"
            aria-label={t("bookHome.head.next")}
            disabled={after === undefined}
            icon={<ChevronDown aria-hidden className="size-4" />}
            onClick={() => {
              if (after !== undefined) {
                onPick(after.id);
              }
            }}
          />
        </div>
      </Reveal>
    </div>
  );
}
