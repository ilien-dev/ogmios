import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, MessageCircle, PencilLine, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { UpdateHint } from "@/features/update/UpdateHint";
import { cn } from "@/lib/cn";
import type { Navigate, Route } from "./routes";

/** The three things the app is for, and its settings. */
export type Section = "conversation" | "book" | "structures" | "settings";

interface Item {
  section: Section;
  icon: LucideIcon;
  route: Route;
}

const ITEMS: Item[] = [
  { section: "conversation", icon: MessageCircle, route: { name: "home" } },
  { section: "book", icon: BookOpen, route: { name: "books", bookId: null } },
  { section: "structures", icon: PencilLine, route: { name: "structures" } },
];

const SETTINGS: Item = {
  section: "settings",
  icon: Settings,
  route: { name: "settings" },
};

/** The section a screen belongs to: the one its way back leads to. */
export function sectionOf(route: Route): Section {
  switch (route.name) {
    case "books":
    case "recall":
    case "listening":
      return "book";
    case "structures":
    case "settings":
      return route.name;
    default:
      return "conversation";
  }
}

interface EntryProps {
  item: Item;
  current: boolean;
  /** What is due today in the section; nothing is said of none. */
  due: number;
  navigate: Navigate;
}

function Entry({ item, current, due, navigate }: EntryProps): ReactNode {
  const { t } = useTranslation();
  const { section, icon: Icon, route } = item;
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={() => {
        navigate(route);
      }}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors duration-150",
        current
          ? "bg-raised font-medium text-ink"
          : "text-ink-soft hover:bg-raised hover:text-ink",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4",
          current ? "text-accent-text" : "text-ink-faint",
        )}
      />
      {t(`nav.${section}`)}
      {due > 0 && (
        <span
          aria-label={t("nav.due", { count: due })}
          className="ml-auto text-xs font-medium text-accent-text"
        >
          {due}
        </span>
      )}
    </button>
  );
}

interface SidebarProps {
  route: Route;
  navigate: Navigate;
  /** What is due today, by section. */
  counts: Partial<Record<Section, number>>;
}

export function Sidebar({ route, navigate, counts }: SidebarProps): ReactNode {
  const { t } = useTranslation();
  const current = sectionOf(route);
  return (
    <nav
      aria-label={t("nav.label")}
      className="flex w-48 shrink-0 flex-col gap-8 border-r border-line bg-sunken px-3 py-6"
    >
      <p className="flex items-center gap-2.5 px-3 text-base font-semibold tracking-tight text-ink">
        <span aria-hidden className="size-2.5 rounded-full bg-accent" />
        {t("app.name")}
      </p>
      <ul className="flex flex-col gap-1">
        {ITEMS.map((item) => (
          <li key={item.section}>
            <Entry
              item={item}
              current={current === item.section}
              due={counts[item.section] ?? 0}
              navigate={navigate}
            />
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-3">
        <UpdateHint />
        <Entry
          item={SETTINGS}
          current={current === "settings"}
          due={0}
          navigate={navigate}
        />
      </div>
    </nav>
  );
}
