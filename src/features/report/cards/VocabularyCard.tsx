import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import type { Step } from "../steps";
import { CardTitle } from "./CardTitle";

type VocabularyStep = Extract<Step, { kind: "vocabulary" }>;

export function VocabularyCard({
  card,
}: {
  card: VocabularyStep["card"];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8">
      <Reveal>
        <CardTitle>{t("report.vocabulary.title")}</CardTitle>
      </Reveal>
      <Stagger as="ul" className="flex flex-col gap-4">
        {card.items.map((item) => (
          <Reveal
            key={item.english}
            as="li"
            className="flex flex-col gap-1 rounded-lg bg-raised px-5 py-4"
          >
            <p className="text-lead font-medium text-ink">{item.english}</p>

            {item.asked !== null && (
              <Reveal key="asked" as="p" className="text-sm text-ink-faint">
                {t("report.vocabulary.asked", { text: item.asked })}
              </Reveal>
            )}

            {item.note !== null && (
              <Reveal key="note" as="p" className="text-ink-soft">
                {item.note}
              </Reveal>
            )}
          </Reveal>
        ))}
      </Stagger>
    </div>
  );
}
