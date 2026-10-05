import type { ReactNode } from "react";
import type { Navigate } from "@/app/routes";
import { ChapterStructuresView } from "./ChapterStructuresView";
import { StructureMenu } from "./StructureMenu";
import { StructureRun } from "./StructureRun";

interface StructuresScreenProps {
  /** The session on the screen, by its id; null outside one. */
  running: string | null;
  /** Instead of the menu: the structures of that chapter. */
  chapterId: string | null;
  /** The book that chapter was opened from; null from the menu. */
  bookId: string | null;
  navigate: Navigate;
}

/**
 * Structures: sentences written one at a time with a structure of English,
 * until it comes out by itself in a real conversation. Its menu lists them
 * all, by level; a chapter has its own, the ones its text uses most; a
 * session takes the whole window.
 */
export function StructuresScreen({
  running,
  chapterId,
  bookId,
  navigate,
}: StructuresScreenProps): ReactNode {
  if (running !== null) {
    return (
      <StructureRun
        key={running}
        sittingId={running}
        onLeave={() => {
          navigate({ name: "structures" });
        }}
        onAgain={(next) => {
          navigate({ name: "structures", running: next });
        }}
      />
    );
  }
  if (chapterId !== null) {
    return (
      <ChapterStructuresView
        key={chapterId}
        chapterId={chapterId}
        onBack={() => {
          navigate(
            bookId === null
              ? { name: "structures" }
              : { name: "books", bookId, chapterId },
          );
        }}
        onStarted={(sittingId) => {
          navigate({ name: "structures", running: sittingId });
        }}
      />
    );
  }
  return <StructureMenu navigate={navigate} />;
}
