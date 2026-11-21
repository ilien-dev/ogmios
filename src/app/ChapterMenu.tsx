import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowRight, BookOpen, ChevronDown, Search, X } from "lucide-react";
import type { Book, Chapter } from "@shared/domain";
import { READY } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { BigNumber } from "@/components/scene/Stats";
import { chapterName } from "@/features/books/chapterName";
import type { Current } from "@/features/books/currentChapter";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT } from "@/lib/motion";
import type { Navigate } from "./routes";

type Filter = "all" | "learning" | "ready" | "unprepared";

const FILTERS: readonly Filter[] = ["all", "learning", "ready", "unprepared"];

function standing(chapter: Chapter): Exclude<Filter, "all"> {
  if (chapter.readiness === null) {
    return "unprepared";
  }
  return chapter.readiness >= READY ? "ready" : "learning";
}

function matches(chapter: Chapter, name: string, query: string): boolean {
  const asked = query.trim().toLowerCase();
  if (asked === "") {
    return true;
  }
  return (
    String(chapter.index + 1) === asked || name.toLowerCase().includes(asked)
  );
}

interface ChapterMenuProps {
  books: readonly Book[];
  current: Current | null;
  navigate: Navigate;
}

/** A thin bar of how ready a chapter is, mint while learning, teal once ready. */
function ReadyBar({
  readiness,
  className,
}: {
  readiness: number | null;
  className?: string;
}): ReactNode {
  return (
    <span
      className={cn(
        "block h-1.5 w-full overflow-hidden rounded-full bg-raised",
        className,
      )}
    >
      <motion.span
        className={cn(
          "block h-full rounded-full",
          (readiness ?? 0) >= READY ? "bg-book" : "bg-mint",
        )}
        initial={{ width: 0 }}
        animate={{ width: `${readiness ?? 0}%` }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      />
    </span>
  );
}

/**
 * The chapter the book section is on, and the way to any other: a panel that
 * comes in from the right with the chapter on now, the one after it, and
 * every chapter of every book, which a search and the standing narrow down.
 */
export function ChapterMenu({
  books,
  current,
  navigate,
}: ChapterMenuProps): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const title = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const id = useId();
  const shown = books.map((book) => ({
    book,
    chapters: book.chapters.filter(
      (chapter) =>
        (filter === "all" || standing(chapter) === filter) &&
        matches(chapter, chapterName(chapter, t), query),
    ),
  }));
  const chapters = shown.flatMap((each) => each.chapters);
  const activeId = active === null ? undefined : `${id}-${active}`;
  const all = books.flatMap((book) => book.chapters);
  const counts: Record<Filter, number> = {
    all: all.length,
    learning: all.filter((chapter) => standing(chapter) === "learning").length,
    ready: all.filter((chapter) => standing(chapter) === "ready").length,
    unprepared: all.filter((chapter) => standing(chapter) === "unprepared")
      .length,
  };
  const now = current?.chapter ?? null;
  const next =
    current === null
      ? null
      : (current.book.chapters.find(
          (chapter) => chapter.index === current.chapter.index + 1,
        ) ?? null);

  useEffect(() => {
    if (!open) {
      return;
    }
    list.current?.focus();
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        panel.current?.contains(target) !== true &&
        title.current?.contains(target) !== true
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  useEffect(() => {
    if (open && activeId !== undefined) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeId]);

  const close = (): void => {
    setOpen(false);
    title.current?.focus();
  };

  const toggle = (): void => {
    setActive(current?.chapter.id ?? all[0]?.id ?? null);
    setQuery("");
    setFilter("all");
    setOpen(!open);
  };

  const pick = (chapterId: string): void => {
    const book = books.find((each) =>
      each.chapters.some((chapter) => chapter.id === chapterId),
    );
    setOpen(false);
    if (book !== undefined) {
      navigate({ name: "books", bookId: book.id, chapterId });
    }
  };

  const move = (step: number): void => {
    const at = chapters.findIndex((chapter) => chapter.id === active);
    const to = Math.max(0, Math.min(at + step, chapters.length - 1));
    setActive(chapters[to]?.id ?? null);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown") {
      move(1);
    } else if (event.key === "ArrowUp") {
      move(-1);
    } else if (event.key === "Enter" && active !== null) {
      pick(active);
    } else if (event.key === "Escape") {
      close();
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div className="relative min-w-0">
      <button
        ref={title}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          now === null
            ? t("nav.pickChapter")
            : t("nav.chapterIs", { chapter: chapterName(now, t) })
        }
        title={current?.book.title}
        onClick={toggle}
        className="group flex max-w-full items-center gap-3 rounded-full border border-line bg-surface/80 py-1.5 pr-1.5 pl-3.5 text-left transition-control hover:shadow-lift"
      >
        <BookOpen
          aria-hidden
          className="size-4 shrink-0 text-book transition-transform duration-300 ease-out-expo group-hover:-rotate-6"
        />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-mono text-xs tracking-wider text-ink-faint uppercase">
            {t("nav.currentChapter")}
          </span>
          <span className="truncate text-sm font-semibold text-ink">
            {now === null ? t("nav.pickChapter") : chapterName(now, t)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent-text">
          {t("nav.picker.change")}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 transition-transform duration-300 ease-out-expo",
              open ? "-rotate-90" : "group-hover:translate-y-0.5",
            )}
          />
        </span>
      </button>
      {createPortal(
        <>
          <Presence>
            {open && (
              <motion.div
                key="scrim"
                aria-hidden
                className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
              />
            )}
          </Presence>
          <Presence>
            {open && (
              <motion.aside
                key="panel"
                ref={panel}
                aria-label={t("nav.picker.title")}
                className="fixed inset-y-3 right-3 z-50 flex w-full max-w-md flex-col gap-4 rounded-2xl glass-float p-5"
                initial={{ x: "105%", opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{
                  x: "105%",
                  opacity: 0,
                  transition: { duration: DURATION.exit, ease: EASE_OUT },
                }}
                transition={{ duration: 0.45, ease: EASE_OUT }}
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-semibold tracking-tight text-ink">
                    {t("nav.picker.title")}
                  </h2>
                  <button
                    type="button"
                    aria-label={t("nav.picker.close")}
                    onClick={close}
                    className="group flex size-9 items-center justify-center rounded-full border border-line text-ink-soft transition-control hover:text-ink"
                  >
                    <X
                      aria-hidden
                      className="size-4 transition-transform duration-300 ease-out-expo group-hover:rotate-90"
                    />
                  </button>
                </div>
                <label className="flex items-center gap-2.5 rounded-xl border border-line bg-sunken/70 px-3.5 py-2.5 transition-colors focus-within:border-accent">
                  <Search
                    aria-hidden
                    className="size-4 shrink-0 text-ink-faint"
                  />
                  <input
                    type="search"
                    value={query}
                    placeholder={t("nav.picker.search")}
                    aria-label={t("nav.picker.search")}
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.map((each) => (
                    <button
                      key={each}
                      type="button"
                      aria-pressed={filter === each}
                      onClick={() => {
                        setFilter(each);
                      }}
                      className={cn(
                        "relative flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-control",
                        filter === each
                          ? "border-accent bg-accent-soft text-accent-text"
                          : "border-line text-ink-soft hover:text-ink",
                      )}
                    >
                      {t(`nav.picker.${each}`)}
                      <span className="font-mono">{counts[each]}</span>
                    </button>
                  ))}
                </div>
                <Presence>
                  {now !== null && query === "" && (
                    <Reveal
                      key="now"
                      className="flex flex-col gap-2 rounded-xl border border-accent/50 bg-accent-soft px-4 py-3"
                    >
                      <span className="font-mono text-xs tracking-wider text-ink-faint uppercase">
                        {t("nav.picker.now")}
                      </span>
                      <span className="flex items-end justify-between gap-3">
                        <span className="truncate text-base font-semibold text-ink">
                          {chapterName(now, t)}
                        </span>
                        <BigNumber
                          value={now.readiness ?? 0}
                          unit="%"
                          size="md"
                          className="text-accent-text"
                        />
                      </span>
                      <ReadyBar readiness={now.readiness} />
                    </Reveal>
                  )}
                </Presence>
                <Presence>
                  {next !== null && query === "" && (
                    <Reveal key="next" as="div">
                      <button
                        type="button"
                        onClick={() => {
                          pick(next.id);
                        }}
                        className="group flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface/70 px-4 py-3 text-left transition-control hover:shadow-lift"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="font-mono text-xs tracking-wider text-ink-faint uppercase">
                            {t("nav.picker.next")}
                          </span>
                          <span className="truncate text-sm font-medium text-ink">
                            {chapterName(next, t)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-sm text-accent-text">
                          {t("nav.picker.open")}
                          <ArrowRight
                            aria-hidden
                            className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-1"
                          />
                        </span>
                      </button>
                    </Reveal>
                  )}
                </Presence>
                <div
                  ref={list}
                  role="listbox"
                  tabIndex={-1}
                  aria-label={t("nav.currentChapter")}
                  aria-activedescendant={activeId}
                  onKeyDown={onKeyDown}
                  className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 outline-none"
                >
                  <Presence>
                    {shown.map(({ book, chapters: own }) => (
                      <motion.div
                        key={book.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{
                          opacity: 0,
                          transition: { duration: DURATION.exit },
                        }}
                        role="group"
                        aria-labelledby={`${id}-${book.id}-title`}
                        className="flex flex-col gap-0.5"
                      >
                        <p
                          id={`${id}-${book.id}-title`}
                          className="truncate px-3 py-1.5 font-mono text-xs tracking-wider text-ink-faint uppercase"
                        >
                          {book.title}
                        </p>
                        <Presence>
                          {own.map((chapter) => {
                            const on = chapter.id === now?.id;
                            return (
                              <motion.div
                                key={chapter.id}
                                layout="position"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{
                                  opacity: 0,
                                  transition: { duration: DURATION.exit },
                                }}
                                id={`${id}-${chapter.id}`}
                                role="option"
                                aria-label={chapterName(chapter, t)}
                                aria-selected={on}
                                onClick={() => {
                                  pick(chapter.id);
                                }}
                                onPointerEnter={() => {
                                  setActive(chapter.id);
                                }}
                                className={cn(
                                  "grid cursor-pointer grid-cols-12 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors duration-150",
                                  on
                                    ? "border-accent/60"
                                    : "border-transparent",
                                  chapter.id === active && "bg-raised",
                                )}
                              >
                                <span className="col-span-2 font-mono text-xs text-ink-faint">
                                  {String(chapter.index + 1).padStart(3, "0")}
                                </span>
                                <span
                                  className={cn(
                                    "col-span-6 truncate",
                                    on
                                      ? "font-semibold text-ink"
                                      : "text-ink-soft",
                                  )}
                                >
                                  {chapterName(chapter, t)}
                                </span>
                                <ReadyBar
                                  readiness={chapter.readiness}
                                  className="col-span-2"
                                />
                                <span className="col-span-2 text-right font-mono text-xs text-ink-faint">
                                  {chapter.readiness === null
                                    ? "—"
                                    : `${chapter.readiness} %`}
                                </span>
                              </motion.div>
                            );
                          })}
                        </Presence>
                      </motion.div>
                    ))}
                  </Presence>
                  <Presence>
                    {chapters.length === 0 && (
                      <Reveal
                        key="none"
                        as="p"
                        kind="fade"
                        className="px-3 py-6 text-center text-sm text-ink-faint"
                      >
                        {t("nav.picker.none")}
                      </Reveal>
                    )}
                  </Presence>
                </div>
              </motion.aside>
            )}
          </Presence>
        </>,
        document.body,
      )}
    </div>
  );
}
