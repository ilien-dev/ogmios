import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DictationInfo } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";

interface PausedDictationsProps {
  paused: readonly DictationInfo[];
  onContinue: (id: string) => void;
  onEnd: (id: string) => void;
}

/** The dictations left before their end. */
export function PausedDictations({
  paused,
  onContinue,
  onEnd,
}: PausedDictationsProps): ReactNode {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-ink-faint">
        {t("listening.paused.title")}
      </h2>
      <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface py-1 shadow-card">
        <Presence>
          {paused.map((sitting, index) => (
            <Reveal
              as="li"
              key={sitting.id}
              kind="fade"
              index={index}
              layout="position"
              className="flex items-center gap-3 px-5 py-3"
            >
              <span className="min-w-0 flex-1 text-sm text-ink-soft tabular-nums">
                {t("listening.paused.progress", {
                  done: sitting.done,
                  total: sitting.total,
                })}
              </span>
              <Button
                size="sm"
                variant="primaryBook"
                onClick={() => {
                  onContinue(sitting.id);
                }}
              >
                {t("listening.paused.continue")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onEnd(sitting.id);
                }}
              >
                {t("listening.paused.end")}
              </Button>
            </Reveal>
          ))}
        </Presence>
      </ul>
    </section>
  );
}
