import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DictationSummary, Pace } from "@shared/listening";
import { PACES } from "@shared/listening";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Orb } from "@/components/ui/Orb";
import { GRADE_TEXT } from "@/components/ui/Verdict";
import { cn } from "@/lib/cn";
import { PaceChoice } from "./PaceChoice";
import { Reveal } from "@/components/motion/Reveal";
import { Presence } from "@/components/motion/Presence";

/** The pace a hint points at, from the one a dictation went at. */
function hinted(summary: DictationSummary): Pace {
  const at = PACES.indexOf(summary.pace);
  if (summary.hint === "faster") {
    return PACES[at + 1] ?? summary.pace;
  }
  if (summary.hint === "slower") {
    return PACES[at - 1] ?? summary.pace;
  }
  return summary.pace;
}

interface DictationEndProps {
  summary: DictationSummary;
  /** Another can be started: the book it was on is still there. */
  again: boolean;
  starting: boolean;
  onAgain: (pace: Pace) => void;
  onDone: () => void;
}

/** How a dictation ended, and the way into another at the pace it suggests. */
export function DictationEnd({
  summary,
  again,
  starting,
  onAgain,
  onDone,
}: DictationEndProps): ReactNode {
  const { t } = useTranslation();
  const [pace, setPace] = useState<Pace>(hinted(summary));
  const first = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    first.current?.focus();
  }, []);

  const tallies = [
    ["right", summary.correct, t("listening.summary.correct")],
    ["partial", summary.partial, t("listening.summary.partial")],
    ["wrong", summary.wrong, t("listening.summary.wrong")],
  ] as const;
  return (
    <main className="h-full overflow-y-auto">
      <Stagger className="mx-auto flex max-w-lg flex-col gap-8 px-6 py-12 nav:py-16">
        <Reveal kind="scale" className="self-center">
          <Orb size="md" section="book" />
        </Reveal>
        <Reveal as="header" className="flex flex-col gap-2">
          <h1 className="font-display text-display font-light text-ink">
            {t("listening.summary.title")}
          </h1>
          <p className="text-lead text-ink-soft">
            {t("listening.summary.lead", {
              right: summary.right,
              total: summary.total,
              pace: t(`listening.pace.${summary.pace}`).toLowerCase(),
            })}
          </p>
        </Reveal>
        <Reveal>
          <dl className="flex gap-10">
            {tallies.map(([grade, count, label]) => (
              <div key={grade} className="flex flex-col">
                <dd
                  className={cn(
                    "font-display text-title font-normal tabular-nums",
                    GRADE_TEXT[grade],
                  )}
                >
                  {count}
                </dd>
                <dt className="text-sm text-ink-soft">{label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>
        <Reveal className="flex flex-col gap-2">
          <p className="font-medium text-accent-text">
            {summary.understood === null
              ? t("listening.summary.notYet")
              : t("listening.summary.understood", {
                  pace: t(`listening.pace.${summary.understood}`).toLowerCase(),
                })}
          </p>
          <Presence>
            {summary.hint !== null && (
              <Reveal key="hint" as="p" className="text-ink-soft">
                {t(`listening.summary.hint.${summary.hint}`)}
              </Reveal>
            )}
          </Presence>
        </Reveal>
        <Presence>
          {again && (
            <Reveal key="again" className="flex flex-col items-start gap-2">
              <p className="text-sm text-ink-faint">
                {t("listening.summary.next")}
              </p>
              <PaceChoice value={pace} onChange={setPace} />
            </Reveal>
          )}
        </Presence>
        <Reveal className="flex gap-2">
          <Presence>
            {again && (
              <Reveal key="again" as="span" kind="fade">
                <Button
                  ref={first}
                  variant="primaryBook"
                  disabled={starting}
                  onClick={() => {
                    onAgain(pace);
                  }}
                >
                  {t("listening.summary.again")}
                </Button>
              </Reveal>
            )}
          </Presence>
          <Button
            ref={again ? undefined : first}
            variant="ghost"
            onClick={onDone}
          >
            {t("common.done")}
          </Button>
        </Reveal>
      </Stagger>
    </main>
  );
}
