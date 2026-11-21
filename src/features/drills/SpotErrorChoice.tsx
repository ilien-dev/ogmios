import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";

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
      <Stagger className="flex flex-col gap-3">
        {options.map((option) => (
          <Reveal key={option}>
            <button
              type="button"
              onClick={() => {
                onPick(option);
              }}
              className="w-full rounded-lg glass px-4 py-3.5 text-left text-lead text-ink transition-control hover:border-accent/40 hover:shadow-lift"
            >
              {option}
            </button>
          </Reveal>
        ))}
      </Stagger>
    </fieldset>
  );
}
