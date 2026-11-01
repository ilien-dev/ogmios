import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { AnalysisProgress } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Orb } from "@/components/ui/Orb";
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
      <Stagger className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <Orb size="lg" state="thinking" shared />
        <Reveal as="div" className="flex flex-col gap-2">
          <h1 className="text-title font-semibold text-ink">
            {t("analysis.title")}
          </h1>
          <p className="text-sm text-ink-soft">{t("analysis.note")}</p>
        </Reveal>
        <Reveal as="div" className="w-full">
          <ol aria-live="polite" className="flex flex-col gap-4">
            {STEPS.map((name, i) => {
              const done = i < reached;
              const current = i === reached;
              return (
                <li
                  key={name}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex items-center justify-center gap-3 text-base",
                    done || current ? "text-ink" : "text-ink-faint",
                  )}
                >
                  <span className="grid size-5 place-items-center">
                    <Presence>
                      {done ? (
                        <Reveal
                          key="done"
                          as="span"
                          kind="scale"
                          index={0}
                          className="col-start-1 row-start-1"
                        >
                          <Check
                            aria-hidden
                            className="size-4 text-accent-text"
                          />
                        </Reveal>
                      ) : current ? (
                        <Reveal
                          key="current"
                          as="span"
                          kind="scale"
                          index={0}
                          className="col-start-1 row-start-1"
                        >
                          <Spinner className="text-accent-text" />
                        </Reveal>
                      ) : (
                        <Reveal
                          key="waiting"
                          as="span"
                          kind="scale"
                          index={0}
                          aria-hidden
                          className="col-start-1 row-start-1 size-1.5 rounded-full bg-line-strong"
                        />
                      )}
                    </Presence>
                  </span>
                  {t(`analysis.${name}`)}
                </li>
              );
            })}
          </ol>
        </Reveal>
      </Stagger>
    </main>
  );
}
