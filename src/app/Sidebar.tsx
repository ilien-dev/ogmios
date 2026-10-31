import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Ear,
  House,
  Languages,
  Layers,
  MessageCircle,
  Repeat,
  Settings,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Book } from "@shared/domain";
import { Logo } from "@/components/ui/Logo";
import { Select } from "@/components/ui/Select";
import { chapterName } from "@/features/books/chapterName";
import type { Current } from "@/features/books/currentChapter";
import { UpdateHint } from "@/features/update/UpdateHint";
import { cn } from "@/lib/cn";
import type { Navigate, Route } from "./routes";

/** The two things the app is for. */
type Group = "conversation" | "book";

/** Every place the menu leads to. */
export type Entry =
  | "home"
  | "conversation"
  | "drills"
  | "progress"
  | "vocabulary"
  | "translate"
  | "structures"
  | "listening"
  | "recall"
  | "books";

/** The place a screen belongs to, the one marked while it shows. */
export function entryOf(route: Route): Entry | "settings" {
  switch (route.name) {
    case "home":
      return "home";
    case "practice":
      return "drills";
    case "report":
      return route.origin === "progress" ? "progress" : "conversation";
    case "books":
      if (route.chapterId === undefined) {
        return "books";
      }
      return route.translating === true ? "translate" : "vocabulary";
    case "progress":
    case "recall":
    case "structures":
    case "listening":
    case "settings":
      return route.name;
    default:
      return "conversation";
  }
}

const SHELF: Route = { name: "books", bookId: null };

/** Where each place of the book section leads, on the current chapter. */
function bookRoutes(current: Current | null): Partial<Record<Entry, Route>> {
  if (current === null) {
    return { vocabulary: SHELF, translate: SHELF, listening: SHELF };
  }
  const chapter = {
    name: "books",
    bookId: current.book.id,
    chapterId: current.chapter.id,
  } as const;
  return {
    vocabulary: chapter,
    translate: { ...chapter, translating: true },
    listening: { name: "listening", chapterId: current.chapter.id },
  };
}

const TONES = { conversation: "text-you", book: "text-book" } as const;

interface PlaceProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** What is due today. */
  count?: number;
  group?: Group;
  onClick: () => void;
}

/** One row of the menu. */
function Place({
  label,
  icon: Icon,
  active,
  count = 0,
  group,
  onClick,
}: PlaceProps): ReactNode {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={
        count > 0 ? `${label}, ${t("nav.due", { count })}` : undefined
      }
      onClick={onClick}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm transition-colors duration-150",
        active
          ? "bg-raised font-medium text-ink"
          : "text-ink-soft hover:bg-raised hover:text-ink",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          active && group !== undefined ? TONES[group] : "text-ink-faint",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            "rounded-sm px-1.5 font-mono text-xs",
            group === "book"
              ? "bg-book-soft text-book"
              : "bg-you-soft text-you",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

interface ChapterPickerProps {
  books: readonly Book[];
  current: Current | null;
  navigate: Navigate;
}

/** The chapter the book section is on; picking another opens it. */
function ChapterPicker({
  books,
  current,
  navigate,
}: ChapterPickerProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="mb-1 flex flex-col gap-1 px-1">
      {current !== null && (
        <p className="truncate px-1.5 font-serif text-sm text-ink-soft italic">
          {current.book.title}
        </p>
      )}
      <Select
        aria-label={t("nav.currentChapter")}
        value={current?.chapter.id ?? ""}
        onChange={(event) => {
          const bookId = books.find((book) =>
            book.chapters.some((each) => each.id === event.target.value),
          )?.id;
          if (bookId !== undefined) {
            navigate({ name: "books", bookId, chapterId: event.target.value });
          }
        }}
      >
        {current === null && (
          <option value="" disabled>
            {t("nav.pickChapter")}
          </option>
        )}
        {books.map((book) => (
          <optgroup key={book.id} label={book.title}>
            {book.chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapterName(chapter, t)}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}

interface SidebarProps {
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
 * The menu, always in view on the left: every place at once, each under one
 * group and only there, so it takes the place of a way back between sections.
 */
export function Sidebar({
  route,
  navigate,
  counts,
  books,
  current,
}: SidebarProps): ReactNode {
  const { t } = useTranslation();
  const on = entryOf(route);
  const chapterRoutes = bookRoutes(current);
  const place = (
    entry: Entry,
    icon: LucideIcon,
    target: Route,
    group: Group,
  ): ReactNode => (
    <Place
      label={t(`nav.entries.${entry}`)}
      icon={icon}
      active={on === entry}
      count={counts[entry]}
      group={group}
      onClick={() => {
        navigate(target);
      }}
    />
  );

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-canvas px-3 py-4">
      <p className="flex items-center gap-2 px-2.5 font-display text-lg font-medium tracking-tight text-ink">
        <Logo className="size-6" />
        {t("app.name")}
      </p>
      <Place
        label={t("nav.entries.home")}
        icon={House}
        active={on === "home"}
        onClick={() => {
          navigate({ name: "home" });
        }}
      />
      <nav aria-labelledby="nav-conversation" className="flex flex-col gap-0.5">
        <h2
          id="nav-conversation"
          className="mb-1 px-2.5 text-xs font-medium text-you"
        >
          {t("nav.groups.conversation")}
        </h2>
        {place(
          "conversation",
          MessageCircle,
          { name: "setup", preset: null },
          "conversation",
        )}
        {place(
          "drills",
          Zap,
          { name: "practice", patternId: null, format: null, autostart: false },
          "conversation",
        )}
        {place("progress", BarChart3, { name: "progress" }, "conversation")}
      </nav>
      <nav aria-labelledby="nav-book" className="flex flex-col gap-0.5">
        <h2 id="nav-book" className="mb-1 px-2.5 text-xs font-medium text-book">
          {t("nav.groups.book")}
        </h2>
        {books.some((book) => book.chapters.length > 0) && (
          <ChapterPicker books={books} current={current} navigate={navigate} />
        )}
        {place(
          "vocabulary",
          BookMarked,
          chapterRoutes.vocabulary ?? SHELF,
          "book",
        )}
        {place(
          "translate",
          Languages,
          chapterRoutes.translate ?? SHELF,
          "book",
        )}
        {place("structures", Layers, { name: "structures" }, "book")}
        {place("listening", Ear, chapterRoutes.listening ?? SHELF, "book")}
        {place("recall", Repeat, { name: "recall" }, "book")}
        {place("books", BookOpen, SHELF, "book")}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <UpdateHint />
        <Place
          label={t("nav.settings")}
          icon={Settings}
          active={on === "settings"}
          onClick={() => {
            navigate({ name: "settings" });
          }}
        />
      </div>
    </aside>
  );
}
