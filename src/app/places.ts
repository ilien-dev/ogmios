import {
  BarChart3,
  BookMarked,
  BookOpen,
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

export interface Place {
  entry: Entry;
  icon: LucideIcon;
}

export const CONVERSATION_PLACES: readonly Place[] = [
  { entry: "conversation", icon: MessageCircle },
  { entry: "drills", icon: Zap },
  { entry: "progress", icon: BarChart3 },
];

export const BOOK_PLACES: readonly Place[] = [
  { entry: "vocabulary", icon: BookMarked },
  { entry: "translate", icon: Languages },
  { entry: "structures", icon: Layers },
  { entry: "listening", icon: Ear },
  { entry: "recall", icon: Repeat },
  { entry: "books", icon: BookOpen },
];

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
export function bookRoutes(
  current: Current | null,
): Partial<Record<Entry, Route>> {
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

/** Where a place leads from anywhere, on the current chapter. */
export function placeTarget(entry: Entry, current: Current | null): Route {
  switch (entry) {
    case "home":
    case "progress":
    case "structures":
    case "recall":
      return { name: entry };
    case "conversation":
      return { name: "setup", preset: null };
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
