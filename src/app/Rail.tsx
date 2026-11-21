import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Logo } from "@/components/ui/Logo";
import { offered, useUpdate } from "@/features/update/update";
import { cn } from "@/lib/cn";
import type { Place } from "./places";
import { PLACES, placeOf, placeTarget } from "./places";
import type { Navigate, Route } from "./routes";
import { showsNav } from "./routes";

/** The colour each place takes while it is the one on screen. */
const ACTIVE: Record<Place, string> = {
  today: "text-ink",
  book: "text-book",
  talk: "text-partner",
  mine: "text-accent-text",
};

interface ItemProps {
  /** Its accessible name: a count goes into it as words. */
  label: string;
  /** What it says beside the icon. */
  text: string;
  icon: LucideIcon;
  active?: boolean;
  /** The place it leads to: its colour while active. */
  tone: Place;
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

interface RailProps {
  route: Route;
  navigate: Navigate;
  /** Everything that comes back today: the count beside Today. */
  due: number;
}

/**
 * The navigation, along the top of every screen that leaves room for it: the
 * mark, the four places as tabs, and Settings at the far end. It keeps its
 * shape everywhere, and only Today carries a count.
 */
export function Rail({ route, navigate, due }: RailProps): ReactNode {
  const { t } = useTranslation();
  const { state, folded } = useUpdate();
  const on = placeOf(route);
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
          <nav
            aria-label={t("nav.label")}
            className="scrollbar-none flex min-w-0 gap-0.5 overflow-x-auto rounded-full border border-line bg-sunken/80 p-1"
          >
            {PLACES.map(({ place, icon }) => {
              const name = t(`nav.places.${place}`);
              const count = place === "today" ? due : 0;
              return (
                <Item
                  key={place}
                  label={
                    count > 0 ? `${name}, ${t("nav.due", { count })}` : name
                  }
                  text={name}
                  icon={icon}
                  active={on === place}
                  tone={place}
                  count={count}
                  onClick={() => {
                    navigate(placeTarget(place));
                  }}
                />
              );
            })}
          </nav>
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
