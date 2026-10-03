import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PatternState, PatternView } from "@shared/domain";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/text";

/** Active work first, then what is waiting, then what is done. */
const ORDER: PatternState[] = [
  "relapse",
  "focus",
  "improving",
  "detected",
  "mastered",
];

const DOT: Record<PatternState, string> = {
  relapse: "bg-wrong",
  focus: "bg-partial",
  improving: "bg-correct/50",
  detected: "bg-line-strong",
  mastered: "bg-correct",
};

export function PatternList({
  patterns,
}: {
  patterns: PatternView[];
}): ReactNode {
  const { t, i18n } = useTranslation();
  const groups = ORDER.map((state) => ({
    state,
    items: patterns.filter((pattern) => pattern.state === state),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.state} className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
            <span
              aria-hidden
              className={cn("size-2 rounded-full", DOT[group.state])}
            />
            {t(`patternState.${group.state}`)}
            <span className="text-ink-faint tabular-nums">
              {group.items.length}
            </span>
          </h3>
          <ul className="flex flex-col divide-y divide-line">
            {group.items.map((pattern) => (
              <li
                key={pattern.id}
                className="flex flex-col gap-1 py-3 first:pt-0"
              >
                <p className="text-ink">{pattern.description}</p>
                <p className="text-sm text-ink-faint">
                  {[
                    pattern.correctRate === null
                      ? null
                      : t("progress.correctRate", {
                          percent: Math.round(pattern.correctRate * 100),
                        }),
                    t("progress.seen", { count: pattern.sessionsSeen }),
                    pattern.nextReviewAt === null
                      ? null
                      : t("progress.nextReview", {
                          date: formatDate(pattern.nextReviewAt, i18n.language),
                        }),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
