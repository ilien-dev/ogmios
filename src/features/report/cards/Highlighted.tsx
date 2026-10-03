import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { segments } from "./segments";

const TONES = {
  /** The span that holds the error. */
  error:
    "bg-wrong-soft text-ink underline decoration-wrong decoration-wavy decoration-1 underline-offset-4",
  /** The learner's wording that a fluent speaker would change. */
  before:
    "bg-transparent text-inherit underline decoration-line-strong underline-offset-4",
  /** What the fluent speaker said instead. */
  after: "bg-correct-soft text-inherit",
} as const;

/** The learner's sentence, or its rewrite, with some spans marked. */
export function Highlighted({
  text,
  spans,
  tone = "error",
}: {
  text: string;
  spans: string[];
  tone?: keyof typeof TONES;
}): ReactNode {
  return (
    <>
      {segments(text, spans).map((part, index) =>
        part.marked ? (
          <mark
            key={`${index}-${part.text}`}
            className={cn("rounded-sm px-0.5", TONES[tone])}
          >
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
