import type { ReactNode } from "react";
import type { Navigate } from "@/app/routes";
import { ChapterListen } from "./ChapterListen";
import { DictationRun } from "./DictationRun";

interface ListeningScreenProps {
  /** The dictation on the screen, by its id; null outside one. */
  running: string | null;
  /** Instead of a dictation: that chapter, read aloud. */
  reading: string | null;
  navigate: Navigate;
  /** Out of it: back to where it was started from. */
  onLeave: () => void;
}

/**
 * Listening, once it is on: a dictation of a chapter's sentences, or the
 * chapter read aloud from where it was left. Either takes the whole window;
 * what starts them is the chapter's own tab in the book.
 */
export function ListeningScreen({
  running,
  reading,
  navigate,
  onLeave,
}: ListeningScreenProps): ReactNode {
  if (running !== null) {
    return (
      <DictationRun
        key={running}
        sittingId={running}
        onLeave={onLeave}
        onAgain={(next) => {
          navigate({ name: "listening", running: next });
        }}
      />
    );
  }
  if (reading !== null) {
    return <ChapterListen key={reading} chapterId={reading} onBack={onLeave} />;
  }
  return null;
}
