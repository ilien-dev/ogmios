import { useEffect, useState } from "react";
import type { Book } from "@shared/domain";
import { homeState, listBooks, structuresState } from "@/lib/ipc";
import type { Entry } from "./places";
import type { Route } from "./routes";
import { showsNav } from "./routes";

interface Shelf {
  /** What is due today, by place. */
  counts: Partial<Record<Entry, number>>;
  books: Book[];
  /** The chapter opened last. */
  currentId: string | null;
}

const EMPTY: Shelf = { counts: {}, books: [], currentId: null };

/**
 * What is due and the chapter the learner is on change behind every screen:
 * they are read again at every move to a screen that shows the navigation.
 */
export function useShelf(route: Route, enabled: boolean): Shelf {
  const [shelf, setShelf] = useState(EMPTY);

  useEffect(() => {
    if (!enabled || !showsNav(route)) {
      return;
    }
    let live = true;
    Promise.all([homeState(), listBooks(), structuresState()])
      .then(([home, books, structures]) => {
        if (live) {
          setShelf({
            counts: { drills: home.dueReviews, recall: home.dueWords },
            books,
            currentId: structures.chapter?.chapter.id ?? null,
          });
        }
      })
      // Without it the bar still works: it only says nothing of today.
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [enabled, route]);

  return shelf;
}
