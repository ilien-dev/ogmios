import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, MessageCircle, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Logo } from "@/components/ui/Logo";
import type { Current } from "@/features/books/currentChapter";
import { offered, useUpdate } from "@/features/update/update";
import { cn } from "@/lib/cn";
import type { Entry, Place } from "./places";
import {
  BOOK_PLACES,
  CONVERSATION_PLACES,
  entryOf,
  placeTarget,
} from "./places";
import type { Navigate, Route, Section } from "./routes";
import { sectionOf, showsNav } from "./routes";

const ACTIVE = {
  book: "text-book",
  conversation: "text-partner",
  none: "text-ink",
};

interface ItemProps {
  /** Its accessible name: a count goes into it as words. */
  label: string;
  /** What it says beside the icon. */
  text: string;
  icon: LucideIcon;
  active?: boolean;
  /** The colour it takes while active. */
  tone: keyof typeof ACTIVE;
  /** What is due today. */
  count?: number;
  onClick: () => void;
}

/** One place of the bar: a tab with its icon and its name. */
function Item({
  label,
  text,
  icon: Icon,
  active = false,
  tone,
  count = 0,
  onClick,
}: ItemProps): ReactNode {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "group relative flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-control",
        active ? ACTIVE[tone] : "text-ink-soft hover:text-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="rail-pill"
          className="absolute inset-0 rounded-full bg-raised shadow-card"
        />
      )}
      <Icon
        aria-hidden
        className="relative size-4 shrink-0 transition-transform duration-300 ease-out-expo group-hover:scale-115 group-hover:-rotate-6"
      />
      <span className="relative">{text}</span>
      <Presence>
        {count > 0 && (
          <Reveal
            key="count"
            as="span"
            kind="scale"
            className="relative rounded-full bg-tally-soft px-1.5 font-mono text-xs font-semibold text-tally"
          >
            {count}
          </Reveal>
        )}
      </Presence>
    </button>
  );
}

interface SwitchProps {
  section: Section | null;
  navigate: Navigate;
}

const SECTIONS: ReadonlyArray<{ section: Section; icon: LucideIcon }> = [
  { section: "book", icon: BookOpen },
  { section: "conversation", icon: MessageCircle },
];

/** The two things the app is for, one press apart and always in one place. */
function SectionSwitch({ section, navigate }: SwitchProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("nav.sections")}
      className="flex shrink-0 gap-0.5 rounded-full border border-line bg-sunken/80 p-1"
    >
      {SECTIONS.map(({ section: own, icon: Icon }) => {
        const on = own === section;
        return (
          <button
            key={own}
            type="button"
            aria-pressed={on}
            onClick={() => {
              navigate(own === "book" ? { name: "book" } : { name: "home" });
            }}
            className={cn(
              "group relative flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-control",
              on
                ? own === "book"
                  ? "text-on-cta-book"
                  : "text-on-cta"
                : "text-ink-soft hover:text-ink",
            )}
          >
            {on && (
              <motion.span
                layoutId="rail-section"
                className={cn(
                  "absolute inset-0 rounded-full",
                  own === "book" ? "bg-cta-book" : "bg-cta",
                )}
              />
            )}
            <Icon
              aria-hidden
              className="relative size-4 transition-transform duration-300 ease-out-expo group-hover:scale-115"
            />
            <span className="relative">{t(`nav.groups.${own}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A section's places, in the order of its tabs. */
function placesOf(section: Section): readonly Place[] {
  return section === "book" ? BOOK_PLACES : CONVERSATION_PLACES;
}

interface RailProps {
  route: Route;
  navigate: Navigate;
  /** What is due today, by place. */
  counts: Partial<Record<Entry, number>>;
  /** The chapter the learner is on. */
  current: Current | null;
}

/**
 * The navigation, along the top of every screen that leaves room for it: the
 * mark, the two sections, the places of the one on screen as tabs, and
 * Settings at the far end. It keeps its shape everywhere; only the tabs of a
 * section swap when the section does.
 */
export function Rail({
  route,
  navigate,
  counts,
  current,
}: RailProps): ReactNode {
  const { t } = useTranslation();
  const { state, folded } = useUpdate();
  const on = entryOf(route);
  const section = sectionOf(route);
  const waiting = folded && offered(state) !== null;

  return (
    <Presence>
      {showsNav(route) && (
        <Reveal
          key="rail"
          as="aside"
          kind="fade"
          className="relative z-20 flex shrink-0 items-center gap-3 px-2 pt-1"
        >
          <div className="flex shrink-0 items-center gap-2.5 pr-2">
            <Logo className="size-8" />
            <span className="font-display text-2xl font-bold tracking-tighter lowercase">
              ogmios
            </span>
          </div>
          <SectionSwitch section={section} navigate={navigate} />
          <Presence swap>
            {section !== null && (
              <Reveal
                key={section}
                as="nav"
                kind="fade"
                aria-label={t(`nav.groups.${section}`)}
                className="scrollbar-none flex min-w-0 gap-0.5 overflow-x-auto rounded-full border border-line bg-sunken/80 p-1"
              >
                {placesOf(section).map(({ entry, icon }) => {
                  const name = t(`nav.entries.${entry}`);
                  const count = counts[entry] ?? 0;
                  return (
                    <Item
                      key={entry}
                      label={
                        count > 0 ? `${name}, ${t("nav.due", { count })}` : name
                      }
                      text={name}
                      icon={icon}
                      active={on === entry}
                      tone={section}
                      count={count}
                      onClick={() => {
                        navigate(placeTarget(entry, current));
                      }}
                    />
                  );
                })}
              </Reveal>
            )}
          </Presence>
          <button
            type="button"
            aria-current={on === "settings" ? "page" : undefined}
            aria-label={t(waiting ? "nav.settingsWaiting" : "nav.settings")}
            onClick={() => {
              navigate({ name: "settings" });
            }}
            className={cn(
              "group relative ml-auto flex size-11 shrink-0 items-center justify-center rounded-full border border-line transition-control",
              on === "settings"
                ? "bg-raised text-ink shadow-card"
                : "bg-sunken/80 text-ink-soft hover:text-ink",
            )}
          >
            <Settings
              aria-hidden
              className="size-5 transition-transform duration-500 ease-out-expo group-hover:rotate-90"
            />
            <Presence>
              {waiting && (
                <Reveal
                  key="dot"
                  as="span"
                  kind="scale"
                  className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-accent"
                >
                  <span className="block size-full animate-breathe rounded-full bg-accent" />
                </Reveal>
              )}
            </Presence>
          </button>
        </Reveal>
      )}
    </Presence>
  );
}
