import type { ReactNode } from "react";
import type { Book } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import type { Current } from "@/features/books/currentChapter";
import { ChapterMenu } from "./ChapterMenu";
import type { Navigate, Route } from "./routes";
import { sectionOf, showsNav } from "./routes";

interface ChapterBarProps {
  route: Route;
  navigate: Navigate;
  /** The shelf, for picking a chapter. */
  books: readonly Book[];
  /** The chapter the learner is on. */
  current: Current | null;
}

/**
 * Over every screen of the book section: the chapter its places work on, and
 * the way to any other.
 */
export function ChapterBar({
  route,
  navigate,
  books,
  current,
}: ChapterBarProps): ReactNode {
  const shown =
    showsNav(route) &&
    sectionOf(route) === "book" &&
    books.some((book) => book.chapters.length > 0);
  return (
    <Presence>
      {shown && (
        <Reveal
          key="chapter-bar"
          as="header"
          kind="fade"
          className="relative z-10 flex h-14 shrink-0 items-center px-6"
        >
          <ChapterMenu books={books} current={current} navigate={navigate} />
        </Reveal>
      )}
    </Presence>
  );
}
