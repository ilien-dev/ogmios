import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { SentencePart } from "@shared/domain";
import { Learned } from "@/features/books/TranslateRows";
import { cn } from "@/lib/cn";

interface ListenTextProps {
  paragraphs: readonly SentencePart[][][];
  /** The sentence being heard, or the one to start from. */
  place: number;
  onJump: (sentence: number) => void;
}

/**
 * The chapter, a sentence at a time: the one being heard is marked, and the
 * words the learner has learned are underlined as when it is translated.
 */
export function ListenText({
  paragraphs,
  place,
  onJump,
}: ListenTextProps): ReactNode {
  const current = useRef<HTMLSpanElement>(null);
  /** The place of the first sentence of each paragraph. */
  const starts = useMemo(
    () =>
      paragraphs.map((_, at) =>
        paragraphs
          .slice(0, at)
          .reduce((before, paragraph) => before + paragraph.length, 0),
      ),
    [paragraphs],
  );

  useEffect(() => {
    current.current?.scrollIntoView({ block: "center" });
  }, [place]);

  return (
    <div className="flex flex-col gap-5 text-lead text-ink-soft" lang="en">
      {paragraphs.map((paragraph, at) => {
        const start = starts[at] ?? 0;
        return (
          <p key={start}>
            {paragraph.map((sentence, within) => {
              const index = start + within;
              const on = index === place;
              return (
                <span key={index}>
                  <span
                    ref={on ? current : undefined}
                    role="button"
                    tabIndex={-1}
                    aria-current={on ? "true" : undefined}
                    onClick={() => {
                      onJump(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        onJump(index);
                      }
                    }}
                    className={cn(
                      "cursor-pointer rounded-sm box-decoration-clone px-0.5 transition-control hover:bg-raised",
                      on && "bg-book-soft text-ink",
                    )}
                  >
                    <Learned sentences={[sentence]} />
                  </span>{" "}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}
