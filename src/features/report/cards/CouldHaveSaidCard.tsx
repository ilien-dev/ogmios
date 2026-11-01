import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import type { Step } from "../steps";
import { CardTitle } from "./CardTitle";

type CouldHaveSaidStep = Extract<Step, { kind: "couldHaveSaid" }>;

export function CouldHaveSaidCard({
  card,
}: {
  card: CouldHaveSaidStep["card"];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8">
      <Reveal>
        <CardTitle>{t("report.couldHaveSaid.title")}</CardTitle>
      </Reveal>
      <Stagger as="ul" className="flex flex-col gap-4">
        {card.items.map((item) => (
          <Reveal
            key={item.original}
            as="li"
            className="flex flex-col gap-2 rounded-lg bg-raised px-5 py-4"
          >
            <p className="text-ink-soft">
              <span className="sr-only">
                {t("report.couldHaveSaid.said")}:{" "}
              </span>
              {item.original}
            </p>
            <p className="flex items-start gap-2 text-lead font-medium text-ink">
              <ArrowRight
                aria-hidden
                className="mt-1.5 size-4 shrink-0 text-correct"
              />
              <span>
                <span className="sr-only">
                  {t("report.couldHaveSaid.better")}:{" "}
                </span>
                {item.better}
              </span>
            </p>
            <p className="text-sm text-ink-soft">{item.why}</p>
          </Reveal>
        ))}
      </Stagger>
    </div>
  );
}
