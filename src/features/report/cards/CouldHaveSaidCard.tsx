import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import type { Step } from "../steps";

type CouldHaveSaidStep = Extract<Step, { kind: "couldHaveSaid" }>;

export function CouldHaveSaidCard({
  card,
}: {
  card: CouldHaveSaidStep["card"];
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Stagger as="ul" className="flex flex-col gap-3.5">
      {card.items.map((item) => (
        <Reveal
          key={item.original}
          as="li"
          className="flex flex-col gap-2 rounded-xl border border-line bg-sunken/70 px-4 py-3.5"
        >
          <p className="text-ink-faint line-through decoration-line-strong">
            <span className="sr-only">{t("report.couldHaveSaid.said")}: </span>
            {item.original}
          </p>
          <p className="flex items-start gap-2 text-lead font-medium text-ink">
            <ArrowRight
              aria-hidden
              className="mt-1.5 size-4 shrink-0 text-accent-text"
            />
            <span>
              <span className="sr-only">
                {t("report.couldHaveSaid.better")}:{" "}
              </span>
              {item.better}
            </span>
          </p>
          <p className="text-sm leading-relaxed text-ink-soft">{item.why}</p>
        </Reveal>
      ))}
    </Stagger>
  );
}
