import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Quote, Sparkle } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
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
    <Stagger className="flex flex-col gap-8">
      <Reveal>
        <CardTitle>{t("report.achievement.title")}</CardTitle>
      </Reveal>
      <Stagger as="ul" className="flex flex-col gap-4">
        {card.strengths.map((strength) => (
          <Reveal
            key={strength}
            as="li"
            className="flex gap-3 text-lead text-ink"
          >
            <Check
              aria-hidden
              className="mt-1.5 size-5 shrink-0 text-correct"
            />
            {strength}
          </Reveal>
        ))}
      </Stagger>

      {card.bestSentence !== null && (
        <Reveal
          key="bestSentence"
          as="div"
          className="flex flex-col gap-3 rounded-lg bg-correct-soft px-6 py-5"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-correct">
            <Quote aria-hidden className="size-4" />
            {t("report.achievement.best")}
          </p>
          <p className="text-lead font-medium text-ink">{card.bestSentence}</p>
        </Reveal>
      )}

      {card.selfCorrections.length > 0 && (
        <Reveal
          key="selfCorrections"
          as="section"
          className="flex flex-col gap-2"
        >
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkle aria-hidden className="size-4 text-correct" />
            {t("report.achievement.selfCorrections")}
          </h3>
          <ul className="flex flex-col gap-1">
            {card.selfCorrections.map((item) => (
              <li key={item} className="text-ink-soft">
                {item}
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </Stagger>
  );
}
