import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  BookOpen,
  Ear,
  Layers,
  MessageCircle,
  Repeat,
  Settings,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { UpdateHint } from "@/features/update/UpdateHint";
import { cn } from "@/lib/cn";
import type { Navigate, Route } from "./routes";

/** The two things the app is for: speaking, and reading with a book. */
export type Group = "speak" | "read";

/** Every place the menu leads to. */
export type Entry =
  | "conversation"
  | "drills"
  | "progress"
  | "books"
  | "recall"
  | "structures"
  | "listening";

interface Place {
  entry: Entry;
  icon: LucideIcon;
  route: Route;
}

const GROUPS: Record<Group, Place[]> = {
  speak: [
    { entry: "conversation", icon: MessageCircle, route: { name: "home" } },
    {
      entry: "drills",
      icon: Zap,
      route: {
        name: "practice",
        patternId: null,
        format: null,
        autostart: false,
      },
    },
    { entry: "progress", icon: BarChart3, route: { name: "progress" } },
  ],
  read: [
    { entry: "books", icon: BookOpen, route: { name: "books", bookId: null } },
    { entry: "recall", icon: Repeat, route: { name: "recall" } },
    { entry: "structures", icon: Layers, route: { name: "structures" } },
    { entry: "listening", icon: Ear, route: { name: "listening" } },
  ],
};

const ORDER: Group[] = ["speak", "read"];

/** The entry a screen belongs to: the one its way back leads to. */
export function entryOf(route: Route): Entry | "settings" {
  switch (route.name) {
    case "practice":
      return "drills";
    case "progress":
      return "progress";
    case "report":
      return route.origin === "progress" ? "progress" : "conversation";
    case "books":
    case "recall":
    case "structures":
    case "listening":
    case "settings":
      return route.name;
    default:
      return "conversation";
  }
}

function groupOf(entry: Entry): Group {
  return GROUPS.read.some((place) => place.entry === entry) ? "read" : "speak";
}

interface TopNavProps {
  route: Route;
  navigate: Navigate;
  /** What is due today, by entry. */
  counts: Partial<Record<Entry, number>>;
}

/**
 * The menu, across the top. The first row picks between speaking and
 * reading; the second lists that group's places, each with a line on what
 * it is for and what it has due today.
 */
export function TopNav({ route, navigate, counts }: TopNavProps): ReactNode {
  const { t } = useTranslation();
  const current = entryOf(route);
  const group = current === "settings" ? null : groupOf(current);
  const due = (g: Group): number =>
    GROUPS[g].reduce((sum, place) => sum + (counts[place.entry] ?? 0), 0);

  return (
    <header className="shrink-0 border-b border-line bg-canvas">
      <div className="flex items-center gap-4 px-10 py-3">
        <p className="flex items-center gap-2 font-display text-lg font-medium tracking-tight text-ink">
          <Logo className="size-6" />
          {t("app.name")}
        </p>
        <span aria-hidden className="h-5 w-px bg-line-strong" />
        <nav aria-label={t("nav.sections")} className="flex gap-1">
          {ORDER.map((g) => {
            const count = due(g);
            return (
              <button
                key={g}
                type="button"
                aria-current={g === group ? "true" : undefined}
                aria-label={
                  count > 0
                    ? `${t(`nav.groups.${g}`)}, ${t("nav.due", { count })}`
                    : undefined
                }
                onClick={() => {
                  navigate(GROUPS[g][0]?.route ?? { name: "home" });
                }}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-sm px-3 text-sm transition-colors duration-150",
                  g === group
                    ? "bg-raised font-medium text-ink"
                    : "text-ink-soft hover:bg-raised hover:text-ink",
                )}
              >
                {t(`nav.groups.${g}`)}
                {count > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      "rounded-sm px-1.5 font-mono text-xs",
                      g === "read"
                        ? "bg-book-soft text-book"
                        : "bg-you-soft text-you",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <UpdateHint />
          <button
            type="button"
            aria-current={current === "settings" ? "page" : undefined}
            onClick={() => {
              navigate({ name: "settings" });
            }}
            className={cn(
              "flex h-8 items-center gap-2 rounded-sm px-3 text-sm transition-colors duration-150",
              current === "settings"
                ? "bg-raised font-medium text-ink"
                : "text-ink-soft hover:bg-raised hover:text-ink",
            )}
          >
            <Settings aria-hidden className="size-4" />
            {t("nav.settings")}
          </button>
        </div>
      </div>

      {group !== null && (
        <nav
          aria-label={t(`nav.groups.${group}`)}
          className="flex flex-wrap gap-x-10 gap-y-2 px-10"
        >
          {GROUPS[group].map(({ entry, icon: Icon, route: target }) => {
            const active = entry === current;
            const count = counts[entry] ?? 0;
            return (
              <button
                key={entry}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  navigate(target);
                }}
                className={cn(
                  "group relative -mb-px flex flex-col items-start gap-0.5 border-b-2 pt-1 pb-3 text-left transition-colors duration-150",
                  active
                    ? group === "read"
                      ? "border-book"
                      : "border-you"
                    : "border-transparent hover:border-line-strong",
                )}
              >
                <span className="flex items-center gap-2 font-display text-lg text-ink">
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-4",
                      active
                        ? group === "read"
                          ? "text-book"
                          : "text-you"
                        : "text-ink-faint",
                    )}
                  />
                  <span className={active ? "font-normal" : "font-light"}>
                    {t(`nav.entries.${entry}.name`)}
                  </span>
                  {count > 0 && (
                    <span className="font-mono text-xs text-ink-soft">
                      {count}
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink-soft">
                  {t(`nav.entries.${entry}.hint`)}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
