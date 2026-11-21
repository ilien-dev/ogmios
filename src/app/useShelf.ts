import { useCallback, useEffect, useState } from "react";
import type { Book } from "@shared/domain";
import { homeState, listBooks, openChapter, structuresState } from "@/lib/ipc";
import type { Route } from "./routes";
import { showsNav } from "./routes";

interface Held {
  /** Everything that comes back today: words, drills and structures. */
  due: number;
  books: Book[];
  /** The chapter the learner is on. */
  currentId: string | null;
  /** The shelf has been read once: an empty one is really empty. */
  loaded: boolean;
}

export interface Shelf extends Held {
  /** Makes that chapter the one the learner is on, here and for good. */
  pick: (chapterId: string) => void;
}

const EMPTY: Held = { due: 0, books: [], currentId: null, loaded: false };

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
            due:
              home.dueWords +
              home.dueReviews +
              structures.structures.filter((each) => each.due).length,
            books,
            currentId: structures.chapter?.chapter.id ?? null,
            loaded: true,
          });
        }
      })
      // Without it the bar still works: it only says nothing of today.
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [enabled, route]);

  const pick = useCallback((chapterId: string): void => {
    // Shown at once; the backend is told so that it holds after a restart.
    setShelf((held) => ({ ...held, currentId: chapterId }));
    openChapter(chapterId).catch(() => null);
  }, []);

  return { ...shelf, pick };
}
