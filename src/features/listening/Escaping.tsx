import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ListeningState } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";

const CHIP = "rounded-full bg-raised px-3 py-1 text-sm text-ink-soft";

/** The words that escape the ear, and the ones the dictations bring back. */
export function Escaping({ state }: { state: ListeningState }): ReactNode {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink-faint">
          {t("listening.missed.title")}
        </h2>
        <Stagger as="ul" className="flex flex-wrap gap-2">
          {state.missed.map((each) => (
            <Reveal as="li" key={each.word} kind="scale" className={CHIP}>
              <span className="font-medium text-ink" lang="en">
                {each.word}
              </span>
              {` · ${t("listening.missed.times", { count: each.times })}`}
            </Reveal>
          ))}
        </Stagger>
      </div>
      <Presence>
        {state.reinforced.length > 0 && (
          <Reveal key="reinforced" className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-ink-faint">
              {t("listening.reinforced.title")}
            </h2>
            <Stagger as="ul" className="flex flex-wrap gap-2">
              {state.reinforced.map((word) => (
                <Reveal
                  as="li"
                  key={word}
                  kind="scale"
                  className={CHIP}
                  lang="en"
                >
                  <span className="font-medium text-ink">{word}</span>
                </Reveal>
              ))}
            </Stagger>
            <p className="text-sm text-ink-faint">
              {t("listening.reinforced.hint")}
            </p>
          </Reveal>
        )}
      </Presence>
    </section>
  );
}
