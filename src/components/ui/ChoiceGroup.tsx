import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  badge?: string;
}

interface ChoiceGroupProps<T extends string> {
  legend: string;
  /** Hide the legend visually when the screen's heading already says it. */
  hideLegend?: boolean;
  choices: ReadonlyArray<Choice<T>>;
  value: T | null;
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3 | 4;
  size?: "sm" | "md";
}

const COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/**
 * A set of native radio buttons drawn as selectable tiles. Native radios
 * bring arrow-key movement and the group semantics for free.
 */
export function ChoiceGroup<T extends string>({
  legend,
  hideLegend = false,
  choices,
  value,
  onChange,
  columns = 1,
  size = "md",
}: ChoiceGroupProps<T>): ReactNode {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend
        className={cn(
          "mb-3 text-sm font-medium text-ink",
          hideLegend && "sr-only",
        )}
      >
        {legend}
      </legend>
      <div className={cn("grid gap-2", COLUMNS[columns])}>
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "relative flex cursor-pointer items-start gap-3 rounded-md border transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent-strong",
              size === "sm" ? "px-3 py-2.5" : "px-4 py-3.5",
              choice.value === value
                ? "border-accent-strong bg-accent-soft"
                : "border-line-strong hover:border-ink-faint hover:bg-raised",
            )}
          >
            {/* `relative` on the label keeps this visually hidden radio inside
                it; unanchored, focusing it scrolled the whole window. */}
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={choice.value === value}
              onChange={() => {
                onChange(choice.value);
              }}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn(
                "mt-1 grid size-4 shrink-0 place-items-center rounded-full border",
                choice.value === value
                  ? "border-accent-strong bg-accent"
                  : "border-line-strong",
              )}
            >
              {choice.value === value && (
                <span className="size-1.5 rounded-full bg-on-accent" />
              )}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                {choice.label}
                {choice.badge !== undefined && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-text">
                    {choice.badge}
                  </span>
                )}
              </span>
              {choice.description !== undefined && (
                <span className="text-sm text-ink-soft">
                  {choice.description}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
