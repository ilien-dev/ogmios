import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Strength } from "@shared/domain";
import { cn } from "@/lib/cn";

/** How many of its three dots a strength fills. */
const FILLED: Record<Strength, number> = { new: 1, settling: 2, firm: 3 };
const DOTS = [1, 2, 3] as const;

interface StrengthMarkProps {
  strength: Strength;
  className?: string;
}

/**
 * How strong a learned word is, as three dots: one filled for a new word,
 * two for one that is settling, all three for a firm one. Its name is what
 * a screen reader says, and what hovering shows.
 */
export function StrengthMark({
  strength,
  className,
}: StrengthMarkProps): ReactNode {
  const { t } = useTranslation();
  const label = t(`recall.strength.${strength}`);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {DOTS.map((dot) => (
        <span
          key={dot}
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            dot <= FILLED[strength] ? "bg-learned" : "bg-line-strong",
          )}
        />
      ))}
    </span>
  );
}
