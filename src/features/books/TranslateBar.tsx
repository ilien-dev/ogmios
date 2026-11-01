import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Translation } from "@shared/domain";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { isWhole } from "./useTranslationRun";
import { useWay } from "./useWay";

interface TranslateBarProps {
  translation: Translation;
  native: string;
}

/** Which way the attempt goes, and how far it is. */
export function TranslateBar({
  translation,
  native,
}: TranslateBarProps): ReactNode {
  const { t } = useTranslation();
  const way = useWay(translation.direction, native);
  const { current, paragraphs, total, finished } = translation;
  const done = paragraphs.filter(isWhole).length;
  const being = finished
    ? undefined
    : paragraphs.find((each) => each.index === current);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <span className="rounded-full bg-surface px-4 py-1.5 text-sm font-medium text-ink shadow-card">
        {way}
      </span>
      <div className="w-48">
        <ProgressBar
          label={t("books.translate.progress")}
          value={done}
          total={total}
          tone="book"
        />
      </div>
      <span className="text-sm text-ink-faint tabular-nums">
        {being === undefined
          ? t("books.translate.count", { done, total })
          : t("books.translate.paragraph", { current: being.index + 1, total })}
      </span>
    </div>
  );
}
