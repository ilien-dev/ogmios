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
      className="inline-flex shrink-0 gap-1 rounded-full bg-raised p-1"
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
            "h-9 rounded-full px-4 text-sm transition-control disabled:cursor-not-allowed disabled:text-ink-faint",
            pace === value
              ? "bg-surface font-medium text-ink shadow-card"
              : "text-ink-soft hover:text-ink",
          )}
        >
          {t(`listening.pace.${pace}`)}
        </button>
      ))}
    </div>
  );
}
