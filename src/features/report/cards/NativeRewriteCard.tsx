import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { NativeRewrite } from "@shared/domain";
import { CardTitle } from "./CardTitle";
import { Highlighted } from "./Highlighted";

/**
 * §7.5: one fragment of the learner's, next to how a fluent speaker would say
 * it, and the few changes worth learning from.
 */
export function NativeRewriteCard({
  rewrite,
}: {
  rewrite: NativeRewrite;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <CardTitle>{t("report.nativeRewrite.title")}</CardTitle>
        <p className="text-ink-soft">{t("report.nativeRewrite.intro")}</p>
      </div>
      <div className="grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-faint">
            {t("report.nativeRewrite.original")}
          </p>
          <p className="leading-relaxed text-ink-soft">
            <Highlighted
              text={rewrite.original}
              spans={rewrite.notes.map((note) => note.from)}
              tone="before"
            />
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-faint">
            {t("report.nativeRewrite.rewritten")}
          </p>
          <p className="leading-relaxed font-medium text-ink">
            <Highlighted
              text={rewrite.rewrite}
              spans={rewrite.notes.map((note) => note.to)}
              tone="after"
            />
          </p>
        </div>
      </div>
      {rewrite.notes.length > 0 && (
        <div className="flex flex-col gap-5">
          <h3 className="text-sm font-medium text-ink-faint">
            {t("report.nativeRewrite.changes")}
          </h3>
          <ul className="flex flex-col gap-5">
            {rewrite.notes.map((note) => (
              <li
                key={`${note.from}-${note.to}`}
                className="flex flex-col gap-1"
              >
                <p className="flex flex-wrap items-center gap-x-2 text-ink">
                  <span className="text-ink-soft">
                    <span className="sr-only">
                      {t("report.nativeRewrite.original")}:{" "}
                    </span>
                    {note.from}
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="size-4 shrink-0 text-correct"
                  />
                  <span className="font-medium">
                    <span className="sr-only">
                      {t("report.nativeRewrite.rewritten")}:{" "}
                    </span>
                    {note.to}
                  </span>
                </p>
                <p className="text-sm text-ink-soft">{note.why}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
