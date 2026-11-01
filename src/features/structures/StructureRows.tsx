import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { StructureInfo, StructureSittingInfo } from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { StrengthMark } from "@/features/recall/StrengthMark";
import { cn } from "@/lib/cn";
import { formOf } from "./structureText";

interface PausedRowProps {
  sitting: StructureSittingInfo;
  names: ReadonlyMap<string, string>;
  /** Its place in the list, for the cascade it comes in with. */
  index: number;
  onContinue: () => void;
  onEnd: () => void;
}

/** A session left before its end: gone on with, or finished as it is. */
export function PausedRow({
  sitting,
  names,
  index,
  onContinue,
  onEnd,
}: PausedRowProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Reveal
      as="li"
      kind="fade"
      index={index}
      layout="position"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium text-ink">
          {sitting.structures.map((key) => names.get(key) ?? key).join(", ")}
        </span>
        <span className="text-sm text-ink-soft">
          {t("structures.paused.progress", {
            done: sitting.done,
            total: sitting.total,
          })}
        </span>
      </span>
      <Button size="sm" variant="primaryBook" onClick={onContinue}>
        {t("structures.paused.continue")}
      </Button>
      <Button size="sm" onClick={onEnd}>
        {t("structures.paused.end")}
      </Button>
    </Reveal>
  );
}

interface StructureRowProps {
  structure: StructureInfo;
  picked: boolean;
  /** Its place in the list, for the cascade it comes in with. */
  index: number;
  onToggle: () => void;
}

/** One structure of the list: picked or not for the session to come. */
export function StructureRow({
  structure,
  picked,
  index,
  onToggle,
}: StructureRowProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Reveal as="li" kind="fade" index={index} layout="position">
      <button
        type="button"
        aria-pressed={picked}
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-control hover:bg-raised"
      >
        <span
          aria-hidden
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-sm border",
            picked
              ? "border-book bg-book-soft text-book-ink"
              : "border-line-strong",
          )}
        >
          <Presence>
            {picked && (
              <Reveal key="check" as="span" kind="scale" className="grid">
                <Check className="size-3.5" />
              </Reveal>
            )}
          </Presence>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium text-ink">{structure.name}</span>
          <span className="text-sm text-ink-soft">
            {formOf(structure.key, t)}
            {" · "}
            <span className="italic">{structure.example}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-sm text-ink-faint">
          {structure.due && (
            <span className="font-medium text-accent-text">
              {t("structures.due")}
            </span>
          )}
          {t(`level.${structure.level}`)}
          <StrengthMark strength={structure.strength} />
        </span>
      </button>
    </Reveal>
  );
}
