import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Step } from "./steps";

/**
 * What a step asks. It takes the focus when it comes, so a keyboard or a
 * screen reader starts at the new question; the step that leaves is inert and
 * cannot hold it.
 */
export function StepHeader({ step }: { step: Step }): ReactNode {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <header className="flex flex-col gap-3">
      <h1
        ref={heading}
        tabIndex={-1}
        className="font-display text-display font-light text-balance text-ink focus:outline-none"
      >
        {t(`onboarding.${step}.title`)}
      </h1>
      <p className="text-lead text-ink-soft">{t(`onboarding.${step}.body`)}</p>
    </header>
  );
}
