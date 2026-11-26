import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDot, CircleX } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import type { Tone } from "@/lib/chime";
import type { Grade } from "@/lib/grade";
import { cn } from "@/lib/cn";

/** The colour of a grade as text. */
export const GRADE_TEXT: Record<Grade, string> = {
  right: "text-correct",
  partial: "text-partial",
  wrong: "text-wrong",
};

/** The icon of a grade: its shape says it before its colour does. */
export const ICON = {
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
    <Reveal
      as="p"
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
    </Reveal>
  );
}

/**
 * The card once its answer is checked: its frame, its ground and a halo in
 * the colour of the verdict. The band keeps the colour of the kind of word.
 */
export const VERDICT_WASH: Record<Tone, string> = {
  right: "border-correct bg-correct-wash ring-6 ring-correct-soft",
  partial: "border-partial bg-partial-wash ring-6 ring-partial-soft",
  wrong:
    "border-wrong bg-wrong-wash ring-6 ring-wrong-soft motion-safe:animate-shake",
  neutral: "border-line-strong",
};

const RIBBON: Record<Tone, string> = {
  right: "bg-correct text-on-grade",
  partial: "bg-partial text-on-grade",
  wrong: "bg-wrong text-on-grade",
  neutral: "bg-raised text-ink-soft",
};

interface VerdictRibbonProps {
  tone: Tone;
  children: ReactNode;
}

/** The verdict across the top of its card, in its colour, with its icon. */
export function VerdictRibbon({
  tone,
  children,
}: VerdictRibbonProps): ReactNode {
  const Icon = ICON[tone];
  return (
    <p
      data-ribbon
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-2.5 font-semibold",
        RIBBON[tone],
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      {children}
    </p>
  );
}
