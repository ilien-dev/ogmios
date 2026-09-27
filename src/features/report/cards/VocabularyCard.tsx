import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
    <div className="flex flex-col gap-10">
      <CardTitle>{t("report.vocabulary.title")}</CardTitle>
      <dl className="flex flex-col divide-y divide-line">
        {card.items.map((item) => (
          <div
            key={item.english}
            className="flex flex-col gap-1 py-4 first:pt-0"
          >
            <dt className="text-lead font-medium text-ink">{item.english}</dt>
            {item.asked !== null && (
              <dd className="text-sm text-ink-faint">
                {t("report.vocabulary.asked", { text: item.asked })}
              </dd>
            )}
            {item.note !== null && (
              <dd className="text-ink-soft">{item.note}</dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
