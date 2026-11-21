import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { NativeRewrite } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
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
    <div className="flex flex-col gap-6">
      <Reveal as="p" className="text-ink-soft">
        {t("report.nativeRewrite.intro")}
      </Reveal>
      <Reveal className="grid gap-4 nav:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-sunken/70 px-4 py-3.5">
          <p className="font-mono text-xs tracking-wider text-ink-faint uppercase">
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
        <div className="flex flex-col gap-2 rounded-xl border border-accent/35 bg-accent-soft px-4 py-3.5">
          <p className="font-mono text-xs tracking-wider text-accent-text uppercase">
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
      </Reveal>
      <Presence>
        {rewrite.notes.length > 0 && (
          <Reveal key="notes" className="flex flex-col gap-3">
            <h3 className="text-sm text-ink-faint">
              {t("report.nativeRewrite.changes")}
            </h3>
            <Stagger as="ul" className="flex flex-col gap-3">
              {rewrite.notes.map((note) => (
                <Reveal
                  key={`${note.from}-${note.to}`}
                  as="li"
                  className="flex flex-col gap-1 rounded-xl border border-line bg-sunken/70 px-4 py-3"
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
                      className="size-4 shrink-0 text-accent-text"
                    />
                    <span className="font-medium">
                      <span className="sr-only">
                        {t("report.nativeRewrite.rewritten")}:{" "}
                      </span>
                      {note.to}
                    </span>
                  </p>
                  <p className="text-sm text-ink-soft">{note.why}</p>
                </Reveal>
              ))}
            </Stagger>
          </Reveal>
        )}
      </Presence>
    </div>
  );
}
