import { motion } from "motion/react";
import { Search } from "lucide-react";
import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import { READY } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { DURATION, EASE_OUT, staggerDelay } from "@/lib/motion";
import { chapterShortcuts, searchChapters } from "./chapterSearch";
import { chapterName } from "./chapterName";

/** A place in the book the search jumps to in one step. */
interface Jump {
  key: string;
  label: string;
  to: Chapter;
}

/** Marks the rows the arrow keys move between. */
const ROW = "data-find-row";

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
    panel.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return;
  }
  rows[Math.min(to, rows.length - 1)]?.focus();
}

/** How ready a chapter is, as a thin bar that fills to it. */
function ReadyBar({ readiness }: { readiness: number | null }): ReactNode {
  return (
    <span
      aria-hidden
      className="block h-1 w-16 shrink-0 overflow-hidden rounded-full bg-raised"
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

interface RowsProps {
  chapters: readonly Chapter[];
  currentId: string;
  onPick: (chapter: Chapter) => void;
}

/** Chapters as rows: number, name, how ready, the current one marked. */
function Rows({ chapters, currentId, onPick }: RowsProps): ReactNode {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-0.5">
      {chapters.map((chapter, index) => {
        const on = chapter.id === currentId;
        return (
          <motion.li
            key={chapter.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
            transition={{
              duration: DURATION.enter,
              ease: EASE_OUT,
              delay: staggerDelay(index),
            }}
          >
            <button
              type="button"
              data-find-row=""
              aria-current={on ? "true" : undefined}
              onClick={() => {
                onPick(chapter);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  step(event, 1);
                } else if (event.key === "ArrowUp") {
                  step(event, -1);
                }
              }}
              className={cn(
                "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-control focus-visible:bg-raised",
                on ? "bg-book-soft" : "hover:bg-raised",
              )}
            >
              <span
                className={cn(
                  "w-7 shrink-0 font-mono text-xs tabular-nums",
                  on ? "text-book-ink" : "text-ink-faint",
                )}
              >
                {String(chapter.index + 1).padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  on ? "font-semibold text-book-ink" : "text-ink",
                )}
              >
                {chapterName(chapter, t)}
              </span>
              <Presence swap>
                {chapter.readiness === null ? (
                  <Reveal
                    key="unprepared"
                    as="span"
                    kind="fade"
                    className="shrink-0 text-xs text-ink-faint"
                  >
                    {t("bookHome.find.unprepared")}
                  </Reveal>
                ) : (
                  <Reveal
                    key="ready"
                    as="span"
                    kind="fade"
                    className="flex shrink-0 items-center gap-3"
                  >
                    <ReadyBar readiness={chapter.readiness} />
                    <span className="w-10 text-right font-mono text-xs text-ink-soft tabular-nums">
                      {`${String(chapter.readiness)} %`}
                    </span>
                  </Reveal>
                )}
              </Presence>
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="px-3 font-mono text-xs font-semibold tracking-wider text-ink-faint uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

interface ChapterFindProps {
  book: Book;
  current: Chapter;
  open: boolean;
  onClose: () => void;
  /** Makes a chapter the one the learner is on. */
  onPick: (chapterId: string) => void;
}

/**
 * The search for a chapter, over the whole screen: before anything is typed,
 * where the learner is, what follows and a few jumps; then the chapters a
 * number or a piece of the title finds. Enter takes the first one found; the
 * arrows move between the rows.
 */
export function ChapterFind({
  book,
  current,
  open,
  onClose,
  onPick,
}: ChapterFindProps): ReactNode {
  const { t } = useTranslation();
  const heading = useId();
  const [query, setQuery] = useState("");
  const name = (chapter: Chapter): string => chapterName(chapter, t);
  const found = searchChapters(book.chapters, query, name);
  const { going, next, jumps } = chapterShortcuts(book.chapters, current.id);
  const searching = query.trim() !== "";

  const close = (): void => {
    setQuery("");
    onClose();
  };
  const pick = (chapter: Chapter): void => {
    onPick(chapter.id);
    close();
  };

  const jumpList: Jump[] = [];
  if (jumps.firstUnprepared !== undefined) {
    jumpList.push({
      key: "firstUnprepared",
      label: t("bookHome.find.firstUnprepared"),
      to: jumps.firstUnprepared,
    });
  }
  if (jumps.lastReady !== undefined) {
    jumpList.push({
      key: "lastReady",
      label: t("bookHome.find.lastReady"),
      to: jumps.lastReady,
    });
  }
  if (jumps.last !== undefined) {
    jumpList.push({
      key: "last",
      label: t("bookHome.find.last", { number: jumps.last.index + 1 }),
      to: jumps.last,
    });
  }

  return (
    <Dialog open={open} labelledBy={heading} onClose={close}>
      <h2 id={heading} className="sr-only">
        {t("bookHome.find.title")}
      </h2>
      <label className="flex items-center gap-3 border-b border-line pb-3">
        <Search aria-hidden className="size-4.5 shrink-0 text-book" />
        <span className="sr-only">{t("bookHome.find.title")}</span>
        <input
          type="search"
          data-autofocus
          value={query}
          placeholder={t("bookHome.find.placeholder", { book: book.title })}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            const first = found[0];
            if (event.key === "Enter" && first !== undefined) {
              event.preventDefault();
              pick(first);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              event.currentTarget
                .closest('[role="dialog"]')
                ?.querySelector<HTMLElement>(`[${ROW}]`)
                ?.focus();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
        />
      </label>
      <div className="relative min-h-40">
        <Presence swap>
          {searching ? (
            found.length > 0 ? (
              <Reveal key="found" kind="fade">
                <Rows chapters={found} currentId={current.id} onPick={pick} />
              </Reveal>
            ) : (
              <Reveal
                key="none"
                as="p"
                kind="fade"
                className="py-6 text-center text-sm text-ink-faint"
              >
                {t("bookHome.find.none")}
              </Reveal>
            )
          ) : (
            <Reveal key="shortcuts" kind="fade" className="flex flex-col gap-4">
              <Group title={t("bookHome.find.going")}>
                <Rows chapters={going} currentId={current.id} onPick={pick} />
              </Group>
              <Presence>
                {next.length > 0 && (
                  <Reveal key="next" kind="fade">
                    <Group title={t("bookHome.find.next")}>
                      <Rows
                        chapters={next}
                        currentId={current.id}
                        onPick={pick}
                      />
                    </Group>
                  </Reveal>
                )}
              </Presence>
              <Presence>
                {jumpList.length > 0 && (
                  <Reveal key="jumps" kind="fade">
                    <Group title={t("bookHome.find.jump")}>
                      <div className="flex flex-wrap gap-2 px-3">
                        {jumpList.map((jump) => (
                          <Button
                            key={jump.key}
                            size="sm"
                            onClick={() => {
                              pick(jump.to);
                            }}
                          >
                            {jump.label}
                          </Button>
                        ))}
                      </div>
                    </Group>
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          )}
        </Presence>
      </div>
      <p className="flex justify-between gap-3 border-t border-line pt-3 text-xs text-ink-faint">
        <span>{t("bookHome.find.hint")}</span>
        <span className="font-mono">{t("bookHome.find.keys")}</span>
      </p>
    </Dialog>
  );
}
