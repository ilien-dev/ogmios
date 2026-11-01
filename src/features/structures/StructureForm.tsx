import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { StructureItem } from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Key } from "@/features/books/TriageRun";
import { FormText } from "./FormText";
import { formOf, usageOf } from "./structureText";

interface StructureFormProps {
  item: StructureItem;
  /** The form is in sight: in the warm-up, or because it was asked for. */
  shown: boolean;
  /** Asks for it; null once the sentence is answered. */
  onShow: (() => void) | null;
}

/**
 * How the structure is built, to the right of where the learner writes. In
 * the warm-up it is there to read; after it, it has to be asked for, and a
 * sentence written with it in sight counts as right with help.
 */
export function StructureForm({
  item,
  shown,
  onShow,
}: StructureFormProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <Presence swap>
        {shown ? (
          <Reveal
            as="aside"
            key="form"
            kind="fade"
            className="flex flex-col gap-3 rounded-xl bg-surface p-5 shadow-card"
          >
            <h2 className="text-sm font-medium text-ink-faint">
              {t("structures.form.title")}
            </h2>
            <p className="text-lead font-semibold text-ink">
              <FormText form={formOf(item.structure, t)} />
            </p>
            <p className="text-ink-soft italic">{item.example}</p>
            <p className="text-sm text-ink-soft">
              {usageOf(item.structure, t)}
            </p>
          </Reveal>
        ) : (
          <Reveal
            as="aside"
            key="hidden"
            kind="fade"
            className="flex flex-col items-start gap-3 rounded-xl bg-raised p-5"
          >
            <p className="text-sm text-ink-soft">
              {t("structures.form.hidden")}
            </p>
            <Presence>
              {onShow !== null && (
                <Reveal key="onShow" as="span" kind="fade">
                  <Button
                    size="sm"
                    aria-keyshortcuts={t("structures.form.showKey")}
                    onClick={onShow}
                  >
                    {t("structures.form.show")}
                    <Key>{t("structures.form.showKey")}</Key>
                  </Button>
                </Reveal>
              )}
            </Presence>
          </Reveal>
        )}
      </Presence>
    </div>
  );
}
