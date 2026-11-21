import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, Quote, Sparkle } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import type { Step } from "../steps";

type AchievementStep = Extract<Step, { kind: "achievement" }>;

export function AchievementCard({
  card,
}: {
  card: AchievementStep["card"];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Stagger className="flex flex-col gap-6">
      <Stagger as="ul" className="flex flex-col gap-3.5">
        {card.strengths.map((strength) => (
          <Reveal
            key={strength}
            as="li"
            className="flex gap-3 text-lead text-ink"
          >
            <CircleCheck
              aria-hidden
              className="mt-1 size-5 shrink-0 text-correct"
            />
            {strength}
          </Reveal>
        ))}
      </Stagger>

      {card.bestSentence !== null && (
        <Reveal
          key="bestSentence"
          as="div"
          className="flex flex-col gap-2 rounded-xl border border-correct/30 bg-correct-soft px-4 py-3.5"
        >
          <p className="flex items-center gap-2 font-mono text-xs tracking-wider text-correct uppercase">
            <Quote aria-hidden className="size-3.5" />
            {t("report.achievement.best")}
          </p>
          <p className="text-xl leading-snug text-ink">{card.bestSentence}</p>
        </Reveal>
      )}

      {card.selfCorrections.length > 0 && (
        <Reveal
          key="selfCorrections"
          as="section"
          className="flex flex-col gap-2"
        >
          <h3 className="flex items-center gap-2 text-sm text-ink-faint">
            <Sparkle
              aria-hidden
              className="size-4 animate-breathe text-correct"
            />
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
