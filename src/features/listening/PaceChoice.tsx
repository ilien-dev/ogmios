import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { Pace } from "@shared/listening";
import { PACES } from "@shared/listening";
import { cn } from "@/lib/cn";

interface PaceChoiceProps {
  value: Pace;
  onChange: (pace: Pace) => void;
  disabled?: boolean;
}

/**
 * The three paces side by side, slowest first; one of them is pressed, and a
 * pill slides to it. Each group has its own pill.
 */
export function PaceChoice({
  value,
  onChange,
  disabled = false,
}: PaceChoiceProps): ReactNode {
  const { t } = useTranslation();
  const name = useId();
  return (
    <div
      role="group"
      aria-label={t("listening.pace.label")}
      className="inline-flex shrink-0 gap-1 rounded-full bg-sunken p-1"
    >
      {PACES.map((pace) => (
        <button
          key={pace}
          type="button"
          aria-pressed={pace === value}
          disabled={disabled}
          onClick={() => {
            onChange(pace);
          }}
          className={cn(
            "relative h-9 rounded-full px-4 text-sm transition-control disabled:cursor-not-allowed disabled:text-ink-faint",
            pace === value
              ? "font-medium text-ink"
              : "text-ink-soft hover:text-ink",
          )}
        >
          {pace === value && (
            <motion.span
              aria-hidden
              layoutId={`${name}-pill`}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className="absolute inset-0 rounded-full bg-surface shadow-card"
            />
          )}
          <span className="relative">{t(`listening.pace.${pace}`)}</span>
        </button>
      ))}
    </div>
  );
}
