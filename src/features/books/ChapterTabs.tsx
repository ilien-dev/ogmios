import { motion } from "motion/react";
import { Ear, Languages, ListChecks, PencilLine } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Chapter } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import type { BookTab, Navigate } from "@/app/routes";
import { BOOK_TABS } from "@/app/routes";
import { cn } from "@/lib/cn";
import { nextTab } from "./bookTabs";
import { chapterName } from "./chapterName";

const ICON: Record<BookTab, LucideIcon> = {
  words: ListChecks,
  listen: Ear,
  translate: Languages,
  write: PencilLine,
};

interface ChapterTabsProps {
  /** The chapter the learner is on: every tab works on it. */
  chapter: Chapter;
  tab: BookTab;
  navigate: Navigate;
}

/**
 * The four things done with a chapter, along the bottom of the book's scene:
 * its words, listening to it, translating it and writing with it. The one
 * the chapter asks for next is marked. Changing chapter keeps the tab.
 */
export function ChapterTabs({
  chapter,
  tab,
  navigate,
}: ChapterTabsProps): ReactNode {
  const { t } = useTranslation();
  const next = nextTab(chapter);
  return (
    <Reveal className="rounded-xl glass p-1.5">
      <div
        role="tablist"
        aria-label={t("bookHome.tabs.label", {
          chapter: chapterName(chapter, t),
        })}
        className="grid grid-cols-2 gap-1 nav:grid-cols-4"
      >
        {BOOK_TABS.map((each) => {
          const on = each === tab;
          const Icon = ICON[each];
          return (
            <button
              key={each}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                navigate({ name: "book", tab: each });
              }}
              className="group relative flex min-w-0 flex-col gap-0.5 rounded-lg px-3.5 py-2.5 text-left transition-control"
            >
              {on && (
                <motion.span
                  layoutId="book-tab"
                  className="absolute inset-0 rounded-lg bg-raised shadow-card"
                />
              )}
              <span
                className={cn(
                  "relative flex items-center gap-2 text-sm font-semibold transition-control",
                  on ? "text-book" : "text-ink-soft group-hover:text-ink",
                )}
              >
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 transition-transform duration-300 ease-out-expo group-hover:scale-115 group-hover:-rotate-6"
                />
                {t(`bookHome.tabs.${each}`)}
                <Presence>
                  {next === each && (
                    <Reveal
                      key="next"
                      as="span"
                      kind="scale"
                      className="rounded-full bg-accent-soft px-1.5 font-mono text-xs font-semibold text-accent-text"
                    >
                      {t("bookHome.tabs.next")}
                    </Reveal>
                  )}
                </Presence>
              </span>
              <span className="relative truncate text-xs text-ink-faint">
                {t(`bookHome.tabs.hint.${each}`)}
              </span>
            </button>
          );
        })}
      </div>
    </Reveal>
  );
}
