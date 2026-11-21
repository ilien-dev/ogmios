import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { StructureSummary } from "@shared/structures";
import { CountUp } from "@/components/motion/CountUp";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Orb } from "@/components/ui/Orb";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { GRADE_TEXT } from "@/components/ui/Verdict";
import { RunCard } from "@/features/drills/ScreenParts";
import { cn } from "@/lib/cn";

interface StructureEndProps {
  summary: StructureSummary;
  names: ReadonlyMap<string, string>;
  starting: boolean;
  onAgain: () => void;
  onDone: () => void;
}

/** How a session ended, and the way into another: practising is never refused. */
export function StructureEnd({
  summary,
  names,
  starting,
  onAgain,
  onDone,
}: StructureEndProps): ReactNode {
  const { t } = useTranslation();
  const again = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    again.current?.focus();
  }, []);

  const tallies = [
    ["right", summary.correct, t("structures.summary.correct")],
    ["partial", summary.partial, t("structures.summary.partial")],
    ["wrong", summary.wrong, t("structures.summary.wrong")],
  ] as const;
  return (
    <main className="h-full overflow-y-auto px-4 py-10">
      <RunCard className="max-w-lg">
        <Stagger className="flex flex-col gap-8">
          <Reveal kind="scale" className="self-center">
            <div className="animate-float">
              <Orb size="md" section="book" />
            </div>
          </Reveal>
          <Reveal as="header" className="flex flex-col gap-2">
            <h1 className="font-display text-display font-light tracking-tight text-ink">
              {t("structures.summary.title")}
            </h1>
            <p className="text-lead text-ink-soft">
              {t("structures.summary.lead", {
                count: summary.correct + summary.partial + summary.wrong,
              })}
            </p>
          </Reveal>
          <Reveal>
            <dl className="flex gap-10 border-y border-line py-4">
              {tallies.map(([grade, count, label]) => (
                <div key={grade} className="flex flex-col">
                  <dd
                    className={cn(
                      "font-display text-title font-light tabular-nums",
                      GRADE_TEXT[grade],
                    )}
                  >
                    <CountUp value={count} />
                  </dd>
                  <dt className="font-mono text-xs text-ink-soft">{label}</dt>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal as="section" className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-ink-faint">
              {t("structures.summary.byStructure")}
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {summary.structures.map((each) => (
                <li key={each.key} className="flex items-center gap-4 py-3">
                  <span className="min-w-0 flex-1 font-display font-medium tracking-tight text-ink">
                    {names.get(each.key) ?? each.key}
                  </span>
                  <span className="w-24">
                    <ProgressBar
                      label={names.get(each.key) ?? each.key}
                      value={each.right}
                      total={each.total}
                      tone="book"
                    />
                  </span>
                  <span className="font-mono text-xs text-ink-faint tabular-nums">
                    {t("structures.summary.count", {
                      right: each.right,
                      total: each.total,
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-soft">
              {t("structures.summary.note")}
            </p>
          </Reveal>
          <Reveal className="flex gap-2">
            <Button
              ref={again}
              variant="primaryBook"
              disabled={starting}
              onClick={onAgain}
            >
              {t("structures.summary.again")}
            </Button>
            <Button variant="ghost" onClick={onDone}>
              {t("common.done")}
            </Button>
          </Reveal>
        </Stagger>
      </RunCard>
    </main>
  );
}
