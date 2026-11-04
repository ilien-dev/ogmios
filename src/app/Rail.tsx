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
  LEADING_PLACES,
  entryOf,
  placeTarget,
} from "./places";
import type { Navigate, Route, Section } from "./routes";
import { sectionOf, showsNav } from "./routes";

const ACTIVE = {
  book: "bg-book-soft text-book-ink",
  conversation: "bg-partner-soft text-partner",
  none: "bg-raised text-ink",
};

interface ItemProps {
  /** Its accessible name: a count goes into it as words. */
  label: string;
  /** What it says under the icon. */
  text: string;
  icon: LucideIcon;
  active?: boolean;
  /** The colour it takes while active. */
  tone: keyof typeof ACTIVE;
  /** What is due today. */
  count?: number;
  /** Something waits behind it. */
  dot?: boolean;
  onClick: () => void;
}

/** One place of the rail: an icon over its name. */
function Item({
  label,
  text,
  icon: Icon,
  active = false,
  tone,
  count = 0,
  dot = false,
  onClick,
}: ItemProps): ReactNode {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative flex w-20 flex-col items-center gap-1 rounded-md px-1 py-2 text-xs font-medium transition-control",
        active ? ACTIVE[tone] : "text-ink-soft hover:bg-raised hover:text-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="rail-pill"
          className={cn("absolute inset-0 rounded-md", ACTIVE[tone])}
        />
      )}
      <Icon aria-hidden className="relative size-5 shrink-0" />
      <span className="relative text-center leading-tight">{text}</span>
      <Presence>
        {count > 0 && (
          <Reveal
            key="count"
            as="span"
            kind="scale"
            className="absolute top-1 right-1 rounded-sm bg-tally-soft px-1 text-xs font-semibold text-tally"
          >
            {count}
          </Reveal>
        )}
        {dot && (
          <Reveal
            key="dot"
            as="span"
            kind="scale"
            className="absolute top-2 right-4 size-2 rounded-full bg-accent"
          />
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
      className="flex flex-col gap-1 rounded-lg bg-sunken p-1"
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
              "relative flex w-20 flex-col items-center gap-1 rounded-md py-2.5 text-xs font-semibold transition-control",
              on
                ? own === "book"
                  ? "text-book"
                  : "text-partner"
                : "text-ink-soft hover:text-ink",
            )}
          >
            {on && (
              <motion.span
                layoutId="rail-section"
                className="absolute inset-0 rounded-md bg-surface shadow-card"
              />
            )}
            <Icon aria-hidden className="relative size-5" />
            <span className="relative">{t(`nav.groups.${own}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A section's places in groups: the book's lead with what it is for. */
function groupsOf(section: Section): Array<readonly Place[]> {
  return section === "book"
    ? [BOOK_PLACES.slice(0, LEADING_PLACES), BOOK_PLACES.slice(LEADING_PLACES)]
    : [CONVERSATION_PLACES];
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
 * The navigation, on the left of every screen that leaves room for it: the
 * two sections, the places of the one on screen and Settings. It keeps its
 * shape everywhere; only the places of a section swap when the section does.
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
          className="relative z-20 flex w-26 shrink-0 flex-col items-center gap-4 overflow-x-hidden overflow-y-auto border-r border-line bg-surface px-2 py-5"
        >
          <Logo className="size-10 shrink-0" />
          <SectionSwitch section={section} navigate={navigate} />
          <div aria-hidden className="h-px w-8 shrink-0 bg-line" />
          <Presence swap>
            {section !== null && (
              <Reveal
                key={section}
                as="nav"
                kind="fade"
                aria-label={t(`nav.groups.${section}`)}
                className="flex flex-col items-center gap-1"
              >
                {groupsOf(section).map((group, at) => (
                  <div
                    key={group[0]?.entry ?? at}
                    className={cn(
                      "flex flex-col items-center gap-1",
                      at > 0 && "mt-1 border-t border-line pt-2",
                    )}
                  >
                    {group.map(({ entry, icon }) => {
                      const name = t(`nav.entries.${entry}`);
                      const count = counts[entry] ?? 0;
                      return (
                        <Item
                          key={entry}
                          label={
                            count > 0
                              ? `${name}, ${t("nav.due", { count })}`
                              : name
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
                  </div>
                ))}
              </Reveal>
            )}
          </Presence>
          <div className="mt-auto">
            <Item
              label={t(waiting ? "nav.settingsWaiting" : "nav.settings")}
              text={t("nav.settings")}
              icon={Settings}
              active={on === "settings"}
              tone="none"
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
