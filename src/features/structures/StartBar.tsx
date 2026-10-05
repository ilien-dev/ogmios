import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { SESSION_SIZES } from "./structureText";

interface StartBarProps {
  size: number;
  onSize: (size: number) => void;
  /** What the session will practise, in a line. */
  note: string;
  /** A session is being started. */
  starting: boolean;
  onStart: () => void;
}

/**
 * The foot of a screen a session starts from: how many sentences, what it
 * will practise, and the way in. It stays in sight under the list above it.
 */
export function StartBar({
  size,
  onSize,
  note,
  starting,
  onStart,
}: StartBarProps): ReactNode {
  const { t } = useTranslation();
  const start = (event: SyntheticEvent): void => {
    event.preventDefault();
    onStart();
  };
  return (
    <form
      onSubmit={start}
      className="shrink-0 border-t border-line bg-surface px-10 py-5"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="text-sm text-ink-soft">{note}</p>
          <Button type="submit" variant="primary" disabled={starting}>
            {t("structures.start")}
          </Button>
        </div>
        <ChoiceGroup
          legend={t("structures.sizes.legend")}
          hideLegend
          columns={4}
          size="sm"
          choices={SESSION_SIZES.map(({ size: each, name, minutes }) => ({
            value: String(each),
            label: t("structures.sizes.label", {
              size: each,
              name: t(`structures.sizes.${name}`),
            }),
            description: t("common.minutes", { count: minutes }),
          }))}
          value={String(size)}
          onChange={(next) => {
            onSize(Number(next));
          }}
        />
      </div>
    </form>
  );
}
