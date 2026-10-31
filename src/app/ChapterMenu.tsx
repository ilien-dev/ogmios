import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { Book } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { chapterName } from "@/features/books/chapterName";
import type { Current } from "@/features/books/currentChapter";
import { cn } from "@/lib/cn";
import type { Navigate } from "./routes";

interface ChapterMenuProps {
  books: readonly Book[];
  current: Current | null;
  navigate: Navigate;
}

/**
 * The chapter the book section is on, and the way to any other. A popover of
 * its own because the system's dropdown cannot be animated.
 */
export function ChapterMenu({
  books,
  current,
  navigate,
}: ChapterMenuProps): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const chapters = books.flatMap((book) => book.chapters);
  const activeId = active === null ? undefined : `${id}-${active}`;

  useEffect(() => {
    if (!open) {
      return;
    }
    list.current?.focus();
    const outside = (event: PointerEvent): void => {
      if (root.current?.contains(event.target as Node) !== true) {
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

  const toggle = (): void => {
    setActive(current?.chapter.id ?? chapters[0]?.id ?? null);
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
    const next = Math.max(0, Math.min(at + step, chapters.length - 1));
    setActive(chapters[next]?.id ?? null);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      move(1);
    } else if (event.key === "ArrowUp") {
      move(-1);
    } else if (event.key === "Enter" && active !== null) {
      pick(active);
    } else if (event.key === "Escape") {
      setOpen(false);
      title.current?.focus();
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={title}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          current === null
            ? undefined
            : t("nav.chapterIs", { chapter: chapterName(current.chapter, t) })
        }
        title={current?.book.title}
        onClick={toggle}
        className="flex h-10 max-w-full items-center gap-1.5 rounded-full px-3 text-sm text-book transition duration-150 hover:bg-book-soft"
      >
        <span className="min-w-0 truncate font-serif italic">
          {current === null
            ? t("nav.pickChapter")
            : chapterName(current.chapter, t)}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0" />
      </button>
      <Presence>
        {open && (
          <Reveal
            key="chapters"
            ref={list}
            kind="scale"
            role="listbox"
            tabIndex={-1}
            aria-label={t("nav.currentChapter")}
            aria-activedescendant={activeId}
            onKeyDown={onKeyDown}
            className="absolute top-full left-0 z-30 mt-2 flex max-h-80 w-72 origin-top-left flex-col gap-3 overflow-y-auto rounded-lg bg-surface p-2 shadow-float outline-none"
          >
            {books.map((book) => (
              <div
                key={book.id}
                role="group"
                aria-labelledby={`${id}-${book.id}-title`}
              >
                <p
                  id={`${id}-${book.id}-title`}
                  className="truncate px-3 py-1.5 font-serif text-sm text-ink-soft italic"
                >
                  {book.title}
                </p>
                {book.chapters.map((chapter) => (
                  <div
                    key={chapter.id}
                    id={`${id}-${chapter.id}`}
                    role="option"
                    aria-selected={chapter.id === current?.chapter.id}
                    onClick={() => {
                      pick(chapter.id);
                    }}
                    onPointerEnter={() => {
                      setActive(chapter.id);
                    }}
                    className={cn(
                      "cursor-pointer truncate rounded-sm px-3 py-2 text-sm",
                      chapter.id === active && "bg-raised",
                      chapter.id === current?.chapter.id
                        ? "font-medium text-ink"
                        : "text-ink-soft",
                    )}
                  >
                    {chapterName(chapter, t)}
                  </div>
                ))}
              </div>
            ))}
          </Reveal>
        )}
      </Presence>
    </div>
  );
}
