import { Presence } from "@/components/motion/Presence";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { VerdictLine } from "@/components/ui/Verdict";
import type { Step } from "../steps";
import { CardTitle } from "./CardTitle";

type ChallengeStep = Extract<Step, { kind: "challenge" }>;

export function ChallengeCard({
  card,
}: {
  card: ChallengeStep["card"];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Stagger className="flex flex-col gap-8">
      <Reveal>
        <CardTitle>{t("report.challenge.title")}</CardTitle>
      </Reveal>
      <Reveal as="p" className="flex gap-4 text-lead font-medium text-ink">
        <Flag aria-hidden className="mt-1.5 size-5 shrink-0 text-accent-text" />
        {card.text}
      </Reveal>
      <Presence>
        {card.previousAchieved !== null && (
          <Reveal key="previousAchieved">
            <VerdictLine
              tone={card.previousAchieved ? "right" : "partial"}
              className="font-normal"
            >
              {card.previousAchieved
                ? t("report.challenge.achieved")
                : t("report.challenge.missed")}
            </VerdictLine>
          </Reveal>
        )}
      </Presence>
    </Stagger>
  );
}
