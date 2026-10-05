import type { ReactNode } from "react";
import type { Navigate } from "@/app/routes";
import { ChapterListen } from "./ChapterListen";
import { DictationRun } from "./DictationRun";
import { ListeningMenu } from "./ListeningMenu";

interface ListeningScreenProps {
  /** The dictation on the screen, by its id; null outside one. */
  running: string | null;
  /** Instead of the menu: that chapter, read aloud. */
  reading: string | null;
  /** The chapter the menu is on; null for the one opened last. */
  chapterId: string | null;
  navigate: Navigate;
}

/**
 * Listening: the ear, trained on the learner's own book. Its menu says the
 * pace they understand and offers two things on a chapter: hearing it read
 * aloud from where it was left, and a dictation of its sentences, which
 * takes the whole window.
 */
export function ListeningScreen({
  running,
  reading,
  chapterId,
  navigate,
}: ListeningScreenProps): ReactNode {
  if (running !== null) {
    return (
      <DictationRun
        key={running}
        sittingId={running}
        onLeave={() => {
          navigate({ name: "listening" });
        }}
        onAgain={(next) => {
          navigate({ name: "listening", running: next });
        }}
      />
    );
  }
  if (reading !== null) {
    return (
      <ChapterListen
        key={reading}
        chapterId={reading}
        onBack={() => {
          navigate({ name: "listening", chapterId: reading });
        }}
      />
    );
  }
  return <ListeningMenu chapterId={chapterId} navigate={navigate} />;
}
