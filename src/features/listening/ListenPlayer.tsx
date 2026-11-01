import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Pace } from "@shared/listening";
import { Swap } from "@/components/motion/Swap";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { PaceChoice } from "./PaceChoice";

interface ListenPlayerProps {
  place: number;
  total: number;
  playing: boolean;
  pace: Pace;
  hidden: boolean;
  onJump: (sentence: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onPace: (pace: Pace) => void;
  onHidden: (hidden: boolean) => void;
}

/** The controls of a chapter read aloud: move, play, pace, and the text. */
export function ListenPlayer({
  place,
  total,
  playing,
  pace,
  hidden,
  onJump,
  onPlay,
  onPause,
  onPace,
  onHidden,
}: ListenPlayerProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-xl bg-surface px-5 py-3 shadow-card">
      <Button
        aria-label={t("listening.reading.previous")}
        icon={<SkipBack aria-hidden className="size-4" />}
        disabled={place === 0}
        onClick={() => {
          onJump(place - 1);
        }}
      />
      <Button
        variant="primaryBook"
        aria-label={
          playing ? t("listening.reading.pause") : t("listening.reading.play")
        }
        icon={
          <Swap id={playing ? "pause" : "play"}>
            {playing ? (
              <Pause aria-hidden className="size-4" />
            ) : (
              <Play aria-hidden className="size-4" />
            )}
          </Swap>
        }
        disabled={total === 0}
        onClick={playing ? onPause : onPlay}
      />
      <Button
        aria-label={t("listening.reading.next")}
        icon={<SkipForward aria-hidden className="size-4" />}
        disabled={place >= total - 1}
        onClick={() => {
          onJump(place + 1);
        }}
      />
      <div className="min-w-24 flex-1">
        <ProgressBar
          label={t("listening.reading.progress")}
          value={place}
          total={Math.max(total - 1, 1)}
          tone="book"
        />
      </div>
      <p className="text-sm text-ink-faint tabular-nums">
        {t("listening.reading.place", { current: place + 1, total })}
      </p>
      <PaceChoice value={pace} onChange={onPace} />
      <Button
        variant="ghost"
        aria-pressed={hidden}
        icon={
          <Swap id={hidden ? "show" : "hide"}>
            {hidden ? (
              <Eye aria-hidden className="size-4" />
            ) : (
              <EyeOff aria-hidden className="size-4" />
            )}
          </Swap>
        }
        onClick={() => {
          onHidden(!hidden);
        }}
      >
        {hidden ? t("listening.reading.show") : t("listening.reading.hide")}
      </Button>
    </div>
  );
}
