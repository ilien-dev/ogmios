import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { VerdictLine } from "@/components/ui/Verdict";
import type { Step } from "../steps";

type ChallengeStep = Extract<Step, { kind: "challenge" }>;

export function ChallengeCard({
  card,
}: {
  card: ChallengeStep["card"];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Stagger className="flex flex-col gap-6">
      <Reveal as="p" className="flex gap-4 text-2xl leading-snug text-ink">
        <Flag
          aria-hidden
          className="mt-1.5 size-6 shrink-0 animate-float text-accent-text"
        />
        {card.text}
      </Reveal>

      {card.previousAchieved !== null && (
        <Reveal
          key="previousAchieved"
          className="rounded-xl border border-line bg-sunken/70 px-4 py-3"
        >
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
    </Stagger>
  );
}
