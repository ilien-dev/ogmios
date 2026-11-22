import { motion } from "motion/react";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import { READY } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, staggerDelay } from "@/lib/motion";
import { searchChapters } from "./chapterSearch";
import { chapterName } from "./chapterName";

/** Marks the rows the arrow keys move between, and the field above them. */
const ROW = "data-pick-row";
const FIELD = "data-pick-field";

/**
 * Moves the focus to the row before or after this one; from the first row
 * up, back to the search field.
 */
function step(event: KeyboardEvent<HTMLElement>, by: 1 | -1): void {
  const panel = event.currentTarget.closest('[role="dialog"]');
  if (panel === null) {
    return;
  }
  const rows = [...panel.querySelectorAll<HTMLElement>(`[${ROW}]`)];
  const at = rows.indexOf(event.currentTarget);
  const to = at + by;
  event.preventDefault();
  if (to < 0) {
    panel.querySelector<HTMLElement>(`[${FIELD}]`)?.focus();
    return;
  }
  rows[Math.min(to, rows.length - 1)]?.focus();
}

/** How ready a chapter is, as a thin bar that fills to it. */
function ReadyBar({ readiness }: { readiness: number | null }): ReactNode {
  return (
    <span
      aria-hidden
      className="block h-1 w-14 shrink-0 overflow-hidden rounded-full bg-raised"
    >
      <motion.span
        className={cn(
          "block h-full rounded-full",
          (readiness ?? 0) >= READY ? "bg-book" : "bg-accent",
        )}
        initial={{ width: 0 }}
        animate={{ width: `${String(readiness ?? 0)}%` }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      />
    </span>
  );
}

interface ChapterPickerProps {
  book: Book;
  current: Chapter;
  /** The control that opened it: the focus goes back there on close. */
  opener: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  /** Makes a chapter the one the learner is on. */
  onPick: (chapterId: string) => void;
}

/**
 * The list of the book's chapters, open under the chapter's name: every one
 * with how ready it is and the current one marked, and above them a field
 * that narrows them by number or title. Enter takes the first one found, the
 * arrows move between the rows, and Escape or a click elsewhere closes it.
 */
export function ChapterPicker({
  book,
  current,
  opener,
  onClose,
  onPick,
}: ChapterPickerProps): ReactNode {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const shown = searching
    ? searchChapters(book.chapters, query, (each) => chapterName(each, t))
    : book.chapters;

  const close = (): void => {
    onClose();
    opener.current?.focus();
  };
  const pick = (chapter: Chapter): void => {
    onPick(chapter.id);
    close();
  };

  // Opens on its field, with the current chapter in view.
  useEffect(() => {
    field.current?.focus();
    panel.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, []);

  // A press anywhere else closes it; on the opener, the opener does.
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        panel.current?.contains(target) === true ||
        opener.current?.contains(target) === true
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
    };
  }, [onClose, opener]);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={t("bookHome.find.title")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-2 shadow-float"
    >
      <label className="flex h-11 items-center gap-3 rounded-lg bg-raised px-3">
        <Search aria-hidden className="size-4 shrink-0 text-ink-soft" />
        <span className="sr-only">{t("bookHome.find.title")}</span>
        <input
          ref={field}
          type="search"
          data-pick-field=""
          value={query}
          placeholder={t("bookHome.find.placeholder")}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            const first = shown[0];
            if (event.key === "Enter" && first !== undefined) {
              event.preventDefault();
              pick(first);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              panel.current?.querySelector<HTMLElement>(`[${ROW}]`)?.focus();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </label>
      <div className="relative max-h-72 min-h-11 overflow-y-auto">
        <Presence swap>
          {shown.length === 0 && (
            <Reveal
              key="none"
              as="p"
              kind="fade"
              className="py-3 text-center text-sm text-ink-faint"
            >
              {t("bookHome.find.none")}
            </Reveal>
          )}
        </Presence>
        <ul className="flex flex-col gap-0.5">
          <Presence firstStatic>
            {shown.map((chapter, index) => {
              const on = chapter.id === current.id;
              return (
                <motion.li
                  key={chapter.id}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    transition: { duration: DURATION.exit },
                  }}
                  transition={{
                    duration: DURATION.enter,
                    ease: EASE_OUT,
                    delay: staggerDelay(index),
                  }}
                >
                  <button
                    type="button"
                    data-pick-row=""
                    aria-current={on ? "true" : undefined}
                    onClick={() => {
                      pick(chapter);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        step(event, 1);
                      } else if (event.key === "ArrowUp") {
                        step(event, -1);
                      }
                    }}
                    className={cn(
                      "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-control focus-visible:bg-raised",
                      on ? "bg-book-soft" : "hover:bg-raised",
                    )}
                  >
                    <span
                      className={cn(
                        "w-6 shrink-0 font-mono text-xs tabular-nums",
                        on ? "text-book-ink" : "text-ink-faint",
                      )}
                    >
                      {String(chapter.index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        on ? "text-book-ink" : "text-ink",
                      )}
                    >
                      {chapterName(chapter, t)}
                    </span>
                    <ReadyBar readiness={chapter.readiness} />
                    <span className="w-10 text-right font-mono text-xs text-ink-soft tabular-nums">
                      <Presence swap>
                        {chapter.readiness === null ? (
                          <Reveal key="unprepared" as="span" kind="fade">
                            <span aria-hidden>–</span>
                            <span className="sr-only">
                              {t("bookHome.find.unprepared")}
                            </span>
                          </Reveal>
                        ) : (
                          <Reveal key="ready" as="span" kind="fade">
                            {`${String(chapter.readiness)} %`}
                          </Reveal>
                        )}
                      </Presence>
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </Presence>
        </ul>
      </div>
      <p className="flex justify-between gap-3 border-t border-line px-3 pt-2 pb-1 text-xs text-ink-faint">
        <span>
          {t("bookHome.find.count", {
            count: searching ? shown.length : book.chapters.length,
          })}
        </span>
        <span className="font-mono">{t("bookHome.find.keys")}</span>
      </p>
    </div>
  );
}
