import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  /** What it turns on and off, for a screen reader: it shows no text. */
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** Something that is on or off, and changes the moment it is pressed. */
export function Switch({
  checked,
  label,
  disabled = false,
  onChange,
}: SwitchProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-control disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-mint" : "bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 left-0.5 size-6 rounded-full bg-surface shadow-card transition-transform duration-300 ease-out-expo motion-reduce:transition-none",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}
