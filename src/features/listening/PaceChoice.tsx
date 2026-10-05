import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Pace } from "@shared/listening";
import { PACES } from "@shared/listening";
import { cn } from "@/lib/cn";

interface PaceChoiceProps {
  value: Pace;
  onChange: (pace: Pace) => void;
  disabled?: boolean;
}

/** The three paces side by side, slowest first; one of them is pressed. */
export function PaceChoice({
  value,
  onChange,
  disabled = false,
}: PaceChoiceProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("listening.pace.label")}
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-line-strong"
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
            "h-10 border-l border-line px-4 text-sm transition-colors duration-150 first:border-l-0 disabled:cursor-not-allowed disabled:text-ink-faint",
            pace === value
              ? "bg-accent-soft font-medium text-ink"
              : "bg-surface text-ink-soft hover:bg-raised hover:text-ink",
          )}
        >
          {t(`listening.pace.${pace}`)}
        </button>
      ))}
    </div>
  );
}
