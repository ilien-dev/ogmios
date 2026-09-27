import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { AnalysisProgress } from "@shared/domain";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { onAnalysisProgress } from "@/lib/ipc";

const STEPS = ["analyzing", "composing"] as const;

interface AnalysisViewProps {
  sessionId: string;
}

/** Shown between "End" and the report while the analysis runs. */
export function AnalysisView({ sessionId }: AnalysisViewProps): ReactNode {
  const { t } = useTranslation();
  const [step, setStep] = useState<AnalysisProgress["step"] | null>(null);

  useEffect(() => {
    const unlisten = onAnalysisProgress((progress) => {
      if (progress.sessionId === sessionId) {
        setStep(progress.step);
      }
    });
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [sessionId]);

  // Each event names the step now under way; before the first, it is the first.
  const reached = step === "done" ? 2 : step === "composing" ? 1 : 0;

  return (
    <main className="grid h-full place-items-center px-8">
      <div className="flex w-full max-w-sm flex-col gap-10 motion-safe:animate-rise">
        <h1 className="text-title font-semibold text-ink">
          {t("analysis.title")}
        </h1>
        <ol aria-live="polite" className="flex flex-col gap-5">
          {STEPS.map((name, i) => {
            const done = i < reached;
            const current = i === reached;
            return (
              <li
                key={name}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-3 text-base",
                  done || current ? "text-ink" : "text-ink-faint",
                )}
              >
                <span className="grid size-5 place-items-center">
                  {done ? (
                    <Check aria-hidden className="size-4 text-accent-text" />
                  ) : current ? (
                    <Spinner className="text-accent-text" />
                  ) : (
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-line-strong"
                    />
                  )}
                </span>
                {t(`analysis.${name}`)}
              </li>
            );
          })}
        </ol>
        <p className="text-sm text-ink-soft">{t("analysis.note")}</p>
      </div>
    </main>
  );
}
