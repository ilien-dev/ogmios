import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Square, Volume2 } from "lucide-react";
import type { DictationItem, Pace } from "@shared/listening";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Key } from "@/features/books/TriageRun";
import { cn } from "@/lib/cn";
import { PaceChoice } from "./PaceChoice";

/** Listening to a sentence more often than this is help. */
const FREE_LISTENS = 2;

interface DictationPlayerProps {
  item: DictationItem;
  pace: Pace;
  playing: boolean;
  onPace: (pace: Pace) => void;
  onListen: () => void;
  onStop: () => void;
}

/**
 * The right of a dictation: the sentence, to hear at a pace. It is a `Reveal`
 * itself, so that it leaves with the answer.
 */
export function DictationPlayer({
  item,
  pace,
  playing,
  onPace,
  onListen,
  onStop,
}: DictationPlayerProps): ReactNode {
  const { t } = useTranslation();
  const heard = item.listens + (playing ? 1 : 0);
  let label = t("listening.run.play");
  if (playing) {
    label = t("listening.run.stop");
  } else if (heard > 0) {
    label = t("listening.run.again");
  }
  return (
    <Reveal
      as="aside"
      kind="fade"
      className="flex flex-col items-start gap-4 rounded-xl bg-surface p-6 shadow-card"
    >
      <Button
        variant="primaryBook"
        size="lg"
        aria-keyshortcuts={t("listening.run.playKey")}
        icon={
          playing ? (
            <Square aria-hidden className="size-4 fill-current" />
          ) : (
            <Volume2 aria-hidden className="size-5" />
          )
        }
        onClick={playing ? onStop : onListen}
      >
        {label}
        {!playing && <Key>{t("listening.run.playKey")}</Key>}
      </Button>
      <PaceChoice value={pace} onChange={onPace} />
      <p
        className={cn(
          "text-sm tabular-nums",
          heard > FREE_LISTENS ? "text-partial" : "text-ink-soft",
        )}
      >
        {t("listening.run.listens", { count: heard })}
      </p>
      <p className="text-sm text-ink-faint">{t("listening.run.free")}</p>
    </Reveal>
  );
}
