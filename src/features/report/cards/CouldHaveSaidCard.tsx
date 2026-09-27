import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronRight } from "lucide-react";
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
    <div className="flex flex-col gap-10">
      <CardTitle>{t("report.couldHaveSaid.title")}</CardTitle>
      <ul className="flex flex-col gap-8">
        {card.items.map((item) => (
          <li key={item.original} className="flex flex-col gap-2">
            <p className="text-ink-soft">
              <span className="sr-only">
                {t("report.couldHaveSaid.said")}:{" "}
              </span>
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
            <p className="text-sm text-ink-soft">{item.why}</p>
          </li>
        ))}
      </ul>
      {card.nativeRewrite !== null && (
        <details className="group rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-5 py-4 text-sm font-medium text-ink hover:bg-raised">
            <ChevronRight
              aria-hidden
              className="size-4 text-ink-faint transition-transform duration-200 group-open:rotate-90"
            />
            {t("report.couldHaveSaid.rewrite")}
          </summary>
          <div className="grid grid-cols-2 gap-6 border-t border-line p-5">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-faint">
                {t("report.couldHaveSaid.original")}
              </p>
              <p className="leading-relaxed text-ink-soft">
                {card.nativeRewrite.original}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-faint">
                {t("report.couldHaveSaid.rewritten")}
              </p>
              <p className="leading-relaxed text-ink">
                {card.nativeRewrite.rewrite}
              </p>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
