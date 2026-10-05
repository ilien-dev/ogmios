import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  ChartNoAxesColumn,
  Dumbbell,
  Headphones,
  House,
  PencilLine,
  Repeat,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { UpdateHint } from "@/features/update/UpdateHint";
import { cn } from "@/lib/cn";
import type { Navigate, Route } from "./routes";

type Section =
  | "home"
  | "practice"
  | "structures"
  | "listening"
  | "books"
  | "recall"
  | "progress"
  | "settings";

const ITEMS: Array<{ section: Section; icon: LucideIcon; route: Route }> = [
  { section: "home", icon: House, route: { name: "home" } },
  {
    section: "practice",
    icon: Dumbbell,
    route: {
      name: "practice",
      patternId: null,
      format: null,
      autostart: false,
    },
  },
  { section: "structures", icon: PencilLine, route: { name: "structures" } },
  { section: "listening", icon: Headphones, route: { name: "listening" } },
  { section: "books", icon: BookOpen, route: { name: "books", bookId: null } },
  { section: "recall", icon: Repeat, route: { name: "recall" } },
  { section: "progress", icon: ChartNoAxesColumn, route: { name: "progress" } },
  { section: "settings", icon: Settings, route: { name: "settings" } },
];

function sectionOf(route: Route): Section {
  switch (route.name) {
    case "practice":
    case "structures":
    case "listening":
    case "books":
    case "recall":
    case "progress":
    case "settings":
      return route.name;
    case "report":
      return "progress";
    default:
      return "home";
  }
}

interface SidebarProps {
  route: Route;
  navigate: Navigate;
}

export function Sidebar({ route, navigate }: SidebarProps): ReactNode {
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
        {ITEMS.map(({ section, icon: Icon, route: target }) => (
          <li key={section}>
            <button
              type="button"
              aria-current={current === section ? "page" : undefined}
              onClick={() => {
                navigate(target);
              }}
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors duration-150",
                current === section
                  ? "bg-raised font-medium text-ink"
                  : "text-ink-soft hover:bg-raised hover:text-ink",
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "size-4",
                  current === section ? "text-accent-text" : "text-ink-faint",
                )}
              />
              {t(`nav.${section}`)}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-auto">
        <UpdateHint
          onOpen={() => {
            navigate({ name: "settings" });
          }}
        />
      </div>
    </nav>
  );
}
