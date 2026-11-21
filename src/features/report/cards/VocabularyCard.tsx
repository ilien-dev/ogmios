import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import type { Step } from "../steps";

type VocabularyStep = Extract<Step, { kind: "vocabulary" }>;

export function VocabularyCard({
  card,
}: {
  card: VocabularyStep["card"];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Stagger as="ul" className="grid gap-3 nav:grid-cols-2">
      {card.items.map((item) => (
        <Reveal
          key={item.english}
          as="li"
          className="flex flex-col gap-1 rounded-xl border border-line bg-sunken/70 px-4 py-3.5"
        >
          <p className="font-display text-xl font-light tracking-tight text-ink">
            {item.english}
          </p>

          {item.asked !== null && (
            <Reveal
              key="asked"
              as="p"
              className="font-mono text-xs text-ink-faint"
            >
              {t("report.vocabulary.asked", { text: item.asked })}
            </Reveal>
          )}

          {item.note !== null && (
            <Reveal key="note" as="p" className="text-sm text-ink-soft">
              {item.note}
            </Reveal>
          )}
        </Reveal>
      ))}
    </Stagger>
  );
}
