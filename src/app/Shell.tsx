import type { ReactNode } from "react";
import type { Book } from "@shared/domain";
import type { Current } from "@/features/books/currentChapter";
import { UpdateCard } from "@/features/update/UpdateCard";
import { ChapterBar } from "./ChapterBar";
import type { Entry } from "./places";
import { Rail } from "./Rail";
import type { Navigate, Route } from "./routes";
import { showsNav } from "./routes";
import { ScreenStage } from "./ScreenStage";

interface ShellProps {
  route: Route;
  navigate: Navigate;
  /** What is due today, by place. */
  counts: Partial<Record<Entry, number>>;
  /** The shelf, for picking a chapter. */
  books: readonly Book[];
  /** The chapter the learner is on. */
  current: Current | null;
  /** The screen of the route. */
  children: ReactNode;
}

/** The rail on the left, and the screens taking turns beside it. */
export function Shell({
  route,
  navigate,
  counts,
  books,
  current,
  children,
}: ShellProps): ReactNode {
  return (
    <div className="relative flex h-full">
      <Rail
        route={route}
        navigate={navigate}
        counts={counts}
        current={current}
      />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ChapterBar
          route={route}
          navigate={navigate}
          books={books}
          current={current}
        />
        <ScreenStage route={route}>{children}</ScreenStage>
        <UpdateCard shown={showsNav(route)} />
      </div>
    </div>
  );
}
