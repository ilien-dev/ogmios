import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDot, CircleX } from "lucide-react";
import type { Grade } from "@/lib/grade";
import { cn } from "@/lib/cn";

/** A grade, or nothing judged: the answer was only shown. */
type Tone = Grade | "neutral";

/** The colour of a grade as text. */
export const GRADE_TEXT: Record<Grade, string> = {
  right: "text-correct",
  partial: "text-partial",
  wrong: "text-wrong",
};

const ICON = {
  right: CircleCheck,
  partial: CircleAlert,
  wrong: CircleX,
  neutral: CircleDot,
};

/** The solid colour of a grade, for a dot or a piece of a bar. */
export const GRADE_FILL: Record<Grade, string> = {
  right: "bg-correct",
  partial: "bg-partial",
  wrong: "bg-wrong",
};

interface VerdictLineProps {
  tone: Tone;
  children: ReactNode;
  className?: string;
}

/**
 * The line that says how an answer went. Its colour and its icon say it
 * before its words: green and a check, amber and a warning, red and a cross.
 */
export function VerdictLine({
  tone,
  children,
  className,
}: VerdictLineProps): ReactNode {
  const Icon = ICON[tone];
  return (
    <p
      className={cn(
        "flex items-center gap-2 font-medium",
        tone === "neutral" ? "text-ink" : GRADE_TEXT[tone],
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-5 shrink-0",
          tone === "neutral" && "text-ink-faint",
        )}
      />
      {children}
    </p>
  );
}
