import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Book } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import type { Current } from "@/features/books/currentChapter";
import { offered, useUpdate } from "@/features/update/update";
import { cn } from "@/lib/cn";
import { ChapterMenu } from "./ChapterMenu";
import type { Entry } from "./places";
import {
  BOOK_PLACES,
  CONVERSATION_PLACES,
  entryOf,
  placeTarget,
} from "./places";
import type { Navigate, Route, Section } from "./routes";
import { sectionOf, showsNav } from "./routes";

const ACTIVE_ICON = { conversation: "text-you", book: "text-book" };
const ACTIVE_PILL = { conversation: "bg-you-soft", book: "bg-book-soft" };
const COUNT = {
  conversation: "bg-you-soft text-you",
  book: "bg-book-soft text-book",
};

interface PillProps {
  /** Its accessible name, whatever shows: `display: none` takes `text` out. */
  label: string;
  /** What it says beside the icon from the `nav` width up; nothing if unset. */
  text?: string;
  icon: LucideIcon;
  active?: boolean;
  /** What is due today. */
  count?: number;
  section: Section | null;
  /** Something waits behind it. */
  dot?: boolean;
  onClick: () => void;
}

/** One way out of the screen, in the bar. */
function Pill({
  label,
  text,
  icon: Icon,
  active = false,
  count = 0,
  section,
  dot = false,
  onClick,
}: PillProps): ReactNode {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "relative flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-control",
        active ? "text-ink" : "text-ink-soft hover:bg-raised hover:text-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-pill"
          className={cn(
            "absolute inset-0 rounded-full",
            section === null ? "bg-raised" : ACTIVE_PILL[section],
          )}
        />
      )}
      <Icon
        aria-hidden
        className={cn(
          "relative size-4 shrink-0",
          active && section !== null ? ACTIVE_ICON[section] : "text-ink-faint",
        )}
      />
      {text !== undefined && (
        <span className="relative hidden nav:inline">{text}</span>
      )}
      <Presence>
        {count > 0 && section !== null && (
          <Reveal
            key="count"
            as="span"
            kind="scale"
            className={cn("relative rounded-sm px-1.5 text-xs", COUNT[section])}
          >
            {count}
          </Reveal>
        )}
        {dot && (
          <Reveal
            key="dot"
            as="span"
            kind="scale"
            className="absolute top-2 right-2 size-2 rounded-full bg-accent"
          />
        )}
      </Presence>
    </button>
  );
}

interface TopBarProps {
  route: Route;
  navigate: Navigate;
  /** What is due today, by place. */
  counts: Partial<Record<Entry, number>>;
  /** The shelf, for picking a chapter. */
  books: readonly Book[];
  /** The chapter the learner is on. */
  current: Current | null;
}

/**
 * The bar over every screen but Home, which has a header of its own, and those
 * that take the whole window: the way back, the places of the section the
 * screen is under, and Settings. Crossing to the other section goes through
 * Home.
 */
export function TopBar({
  route,
  navigate,
  counts,
  books,
  current,
}: TopBarProps): ReactNode {
  const { t } = useTranslation();
  const { state, folded } = useUpdate();
  const on = entryOf(route);
  const section = sectionOf(route);
  const places = section === "book" ? BOOK_PLACES : CONVERSATION_PLACES;
  const waiting = folded && offered(state) !== null;

  return (
    // It leaves on top of the stage, which takes its room back at once.
    <Presence swap>
      {showsNav(route) && route.name !== "home" && (
        <Reveal
          key="bar"
          as="header"
          kind="fade"
          className="relative z-20 flex h-14 w-full shrink-0 items-center gap-2 px-4"
        >
          <Pill
            label={t("nav.entries.home")}
            icon={ArrowLeft}
            section={null}
            onClick={() => {
              navigate({ name: "home" });
            }}
          />
          <Presence>
            {section === "book" &&
              books.some((book) => book.chapters.length > 0) && (
                <Reveal key="chapter" kind="fade" className="min-w-0">
                  <ChapterMenu
                    books={books}
                    current={current}
                    navigate={navigate}
                  />
                </Reveal>
              )}
          </Presence>
          {section !== null && (
            <nav
              aria-label={t(`nav.groups.${section}`)}
              className="mx-auto flex shrink-0 items-center gap-1"
            >
              {places.map(({ entry, icon }) => {
                const name = t(`nav.entries.${entry}`);
                const count = counts[entry] ?? 0;
                return (
                  <Pill
                    key={entry}
                    label={
                      count > 0 ? `${name}, ${t("nav.due", { count })}` : name
                    }
                    text={name}
                    icon={icon}
                    active={on === entry}
                    count={count}
                    section={section}
                    onClick={() => {
                      navigate(placeTarget(entry, current));
                    }}
                  />
                );
              })}
            </nav>
          )}
          <div className="ml-auto shrink-0">
            <Pill
              label={t(waiting ? "nav.settingsWaiting" : "nav.settings")}
              icon={Settings}
              active={on === "settings"}
              section={null}
              dot={waiting}
              onClick={() => {
                navigate({ name: "settings" });
              }}
            />
          </div>
        </Reveal>
      )}
    </Presence>
  );
}
