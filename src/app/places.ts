import {
  BookOpen,
  ChartColumn,
  CircleCheck,
  MessageCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Route } from "./routes";

/**
 * The four places the navigation leads to, by what the learner comes for:
 * what comes back today, learning from a book, learning by talking, and
 * everything they have gathered.
 */
export type Place = "today" | "book" | "talk" | "mine";

export const PLACES: ReadonlyArray<{ place: Place; icon: LucideIcon }> = [
  { place: "today", icon: CircleCheck },
  { place: "book", icon: BookOpen },
  { place: "talk", icon: MessageCircle },
  { place: "mine", icon: ChartColumn },
];

/** The place a screen belongs to, the one marked while it shows. */
export function placeOf(route: Route): Place | "settings" {
  switch (route.name) {
    case "today":
    case "recall":
      return "today";
    case "book":
    case "books":
    case "listening":
      return "book";
    case "progress":
    case "structures":
      return "mine";
    case "settings":
      return "settings";
    default:
      return "talk";
  }
}

/** Where a place leads from anywhere. */
export function placeTarget(place: Place): Route {
  switch (place) {
    case "today":
      return { name: "today" };
    case "book":
      return { name: "book" };
    case "talk":
      return { name: "home" };
    default:
      return { name: "progress" };
  }
}
