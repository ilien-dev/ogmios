import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface SpotErrorChoiceProps {
  options: string[];
  onPick: (sentence: string) => void;
}

/**
 * The first half of a spot-the-error item: choose the sentence with the slip.
 * The second half is rewriting it, which is what goes to the grader.
 */
export function SpotErrorChoice({
  options,
  onPick,
}: SpotErrorChoiceProps): ReactNode {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-medium text-ink">
        {t("drills.pickWrong")}
      </legend>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => {
            onPick(option);
          }}
          className="rounded-md border border-line-strong px-4 py-3.5 text-left text-lead text-ink transition-colors duration-150 hover:border-ink-faint hover:bg-raised"
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
}
