import {
  BarChart3,
  BookOpen,
  ChartColumn,
  Ear,
  Languages,
  Layers,
  MessageCircle,
  Repeat,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Current } from "@/features/books/currentChapter";
import type { Route } from "./routes";

/** Every place the navigation leads to. */
export type Entry =
  | "conversation"
  | "drills"
  | "progress"
  | "chapters"
  | "translate"
  | "structures"
  | "listening"
  | "recall"
  | "books";

export interface Place {
  entry: Entry;
  icon: LucideIcon;
}

export const CONVERSATION_PLACES: readonly Place[] = [
  { entry: "conversation", icon: MessageCircle },
  { entry: "drills", icon: Zap },
  { entry: "progress", icon: BarChart3 },
];

/** The first three are what the section is for; the rest come after a rule. */
export const BOOK_PLACES: readonly Place[] = [
  { entry: "chapters", icon: ChartColumn },
  { entry: "translate", icon: Languages },
  { entry: "recall", icon: Repeat },
  { entry: "structures", icon: Layers },
  { entry: "listening", icon: Ear },
  { entry: "books", icon: BookOpen },
];

/** How many of a section's places lead it, before the rule. */
export const LEADING_PLACES = 3;

/** The place a screen belongs to, the one marked while it shows. */
export function entryOf(route: Route): Entry | "settings" {
  switch (route.name) {
    case "book":
      return "chapters";
    case "practice":
      return "drills";
    case "report":
      return route.origin === "progress" ? "progress" : "conversation";
    case "books":
      if (route.chapterId === undefined) {
        return "books";
      }
      return route.translating === true ? "translate" : "chapters";
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
export function bookRoutes(
  current: Current | null,
): Partial<Record<Entry, Route>> {
  if (current === null) {
    return { translate: SHELF, listening: SHELF };
  }
  const chapter = {
    name: "books",
    bookId: current.book.id,
    chapterId: current.chapter.id,
  } as const;
  return {
    translate: { ...chapter, translating: true },
    listening: { name: "listening", chapterId: current.chapter.id },
  };
}

/** Where a place leads from anywhere, on the current chapter. */
export function placeTarget(entry: Entry, current: Current | null): Route {
  switch (entry) {
    case "progress":
    case "structures":
    case "recall":
      return { name: entry };
    case "conversation":
      return { name: "home" };
    case "chapters":
      return { name: "book" };
    case "drills":
      return {
        name: "practice",
        patternId: null,
        format: null,
        autostart: false,
      };
    default:
      return bookRoutes(current)[entry] ?? SHELF;
  }
}
