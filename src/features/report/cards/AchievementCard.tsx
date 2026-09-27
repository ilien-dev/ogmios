import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Quote, Sparkle } from "lucide-react";
import type { Step } from "../steps";
import { CardTitle } from "./CardTitle";

type AchievementStep = Extract<Step, { kind: "achievement" }>;

export function AchievementCard({
  card,
}: {
  card: AchievementStep["card"];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-10">
      <CardTitle>{t("report.achievement.title")}</CardTitle>
      <ul className="flex flex-col gap-4">
        {card.strengths.map((strength) => (
          <li key={strength} className="flex gap-3 text-lead text-ink">
            <Check
              aria-hidden
              className="mt-1.5 size-5 shrink-0 text-accent-text"
            />
            {strength}
          </li>
        ))}
      </ul>
      {card.bestSentence !== null && (
        <figure className="flex flex-col gap-3 rounded-lg bg-accent-soft px-6 py-5">
          <figcaption className="flex items-center gap-2 text-sm font-medium text-accent-text">
            <Quote aria-hidden className="size-4" />
            {t("report.achievement.best")}
          </figcaption>
          <blockquote className="text-lead font-medium text-ink">
            {card.bestSentence}
          </blockquote>
        </figure>
      )}
      {card.selfCorrections.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkle aria-hidden className="size-4 text-accent-text" />
            {t("report.achievement.selfCorrections")}
          </h3>
          <ul className="flex flex-col gap-1">
            {card.selfCorrections.map((item) => (
              <li key={item} className="text-ink-soft">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
