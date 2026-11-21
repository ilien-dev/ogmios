import { motion } from "motion/react";
import { Search } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import { READY } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { findChapters } from "./bookTabs";
import { chapterWindow } from "./chapterChart";
import { chapterName } from "./chapterName";

/** How many chapters the list shows at once: a book can have a thousand. */
const SHOWN = 12;

/** How ready a chapter is, as a thin bar that fills to it. */
function ReadyBar({ readiness }: { readiness: number | null }): ReactNode {
  return (
    <span
      aria-hidden
      className="block h-1.5 w-full overflow-hidden rounded-full bg-raised"
    >
      <motion.span
        className={cn(
          "block h-full rounded-full",
          (readiness ?? 0) >= READY ? "bg-book" : "bg-mint",
        )}
        initial={{ width: 0 }}
        animate={{ width: `${String(readiness ?? 0)}%` }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      />
    </span>
  );
}

interface ChapterListProps {
  book: Book;
  /** The chapter the learner is on. */
  selected: Chapter;
  /** Makes a chapter the one the learner is on. */
  onPick: (chapterId: string) => void;
  /** Tells the scene which chapter is pointed at, to raise its block. */
  onPoint?: (chapterId: string | null) => void;
}

/**
 * The chapters of the book by name, the one the learner is on marked: the
 * chapters around it, or the ones a search by number or name finds. A row
 * picks its chapter, as its bar in the chart and its block in the scene do.
 */
export function ChapterList({
  book,
  selected,
  onPick,
  onPoint,
}: ChapterListProps): ReactNode {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const shown = searching
    ? findChapters(book.chapters, query, (each) => chapterName(each, t)).slice(
        0,
        SHOWN,
      )
    : chapterWindow(book.chapters, selected.id, SHOWN);
  return (
    <section
      aria-label={t("bookHome.list.title")}
      className="flex flex-col gap-3 rounded-xl glass p-4"
    >
      <header className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="font-display font-medium tracking-tight text-ink">
          {t("bookHome.list.title")}
        </h2>
        <span className="font-mono text-xs text-ink-faint tabular-nums">
          {t("bookHome.position", {
            at: selected.index + 1,
            of: book.chapters.length,
          })}
        </span>
      </header>
      <Presence>
        {book.chapters.length > SHOWN && (
          <Reveal
            key="search"
            kind="fade"
            className="flex items-center gap-2.5 rounded-xl border border-line bg-sunken/70 px-3.5 py-2.5 transition-colors focus-within:border-accent"
          >
            <Search aria-hidden className="size-4 shrink-0 text-ink-faint" />
            <input
              type="search"
              value={query}
              placeholder={t("bookHome.list.search")}
              aria-label={t("bookHome.list.search")}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
            />
          </Reveal>
        )}
      </Presence>
      <ul className="flex flex-col gap-0.5">
        <Presence>
          {shown.map((chapter) => {
            const on = chapter.id === selected.id;
            return (
              <motion.li
                key={chapter.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    onPick(chapter.id);
                  }}
                  onPointerEnter={() => onPoint?.(chapter.id)}
                  onPointerLeave={() => onPoint?.(null)}
                  onFocus={() => onPoint?.(chapter.id)}
                  onBlur={() => onPoint?.(null)}
                  className={cn(
                    "grid w-full grid-cols-12 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-control",
                    on
                      ? "border-book/40 bg-book-soft"
                      : "border-transparent hover:bg-raised",
                  )}
                >
                  <span className="col-span-2 font-mono text-xs text-ink-faint tabular-nums">
                    {String(chapter.index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "col-span-6 truncate",
                      on ? "font-semibold text-book-ink" : "text-ink-soft",
                    )}
                  >
                    {chapterName(chapter, t)}
                  </span>
                  <span className="col-span-2">
                    <ReadyBar readiness={chapter.readiness} />
                  </span>
                  <span className="col-span-2 text-right font-mono text-xs text-ink-faint tabular-nums">
                    {chapter.readiness === null
                      ? "—"
                      : `${String(chapter.readiness)} %`}
                  </span>
                </button>
              </motion.li>
            );
          })}
        </Presence>
      </ul>
      <Presence>
        {shown.length === 0 && (
          <Reveal
            key="none"
            as="p"
            kind="fade"
            className="px-1 py-3 text-center text-sm text-ink-faint"
          >
            {t("bookHome.list.none")}
          </Reveal>
        )}
      </Presence>
      <p className="px-1 text-xs text-ink-faint">{t("bookHome.list.hint")}</p>
    </section>
  );
}
