import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

interface SegmentedProps<T extends string> {
  legend: string;
  choices: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

/**
 * A few choices side by side, native radios underneath, with one pill that
 * slides to the chosen one. Each group has its own pill, so two of them on a
 * screen never trade it.
 */
export function Segmented<T extends string>({
  legend,
  choices,
  value,
  onChange,
}: SegmentedProps<T>): ReactNode {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-medium text-ink">{legend}</legend>
      <div className="flex w-fit gap-1 rounded-full bg-sunken p-1">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "relative flex h-9 min-w-24 cursor-pointer items-center justify-center rounded-full px-4 text-sm font-medium transition-control has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent-strong",
              choice.value === value
                ? "text-ink"
                : "text-ink-soft hover:text-ink",
            )}
          >
            {choice.value === value && (
              <motion.span
                aria-hidden
                data-pill
                layoutId={`${name}-pill`}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="absolute inset-0 rounded-full bg-surface shadow-card"
              />
            )}
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
            <span className="relative">{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
