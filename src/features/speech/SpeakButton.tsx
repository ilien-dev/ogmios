import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Square, Volume2, VolumeX } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/text";
import { useSpeech } from "./speech";

interface SpeakButtonProps {
  /** English, as it is on the screen. */
  text: string;
  className?: string;
}

/**
 * Reads a piece of English aloud, again as often as it is pressed; while it
 * is being read, it stops it. Before the voice is downloaded it is how to get
 * it: pressed, it downloads the voice, and says how far that is.
 */
export function SpeakButton({ text, className }: SpeakButtonProps): ReactNode {
  const { t, i18n } = useTranslation();
  const { status, speaking, say, hush, fetching, fetch } = useSpeech();
  if (status === null) {
    return null;
  }
  const shape = cn(
    "inline-grid size-8 shrink-0 place-items-center rounded-sm align-middle text-ink-faint hover:bg-raised hover:text-ink",
    className,
  );
  if (!status.downloaded) {
    const label =
      fetching === null
        ? t("speech.get", { size: formatBytes(status.bytes, i18n.language) })
        : t("speech.getting", { percent: Math.round(fetching * 100) });
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={fetching !== null}
        onClick={() => {
          // Settings says why a download failed; here it can be pressed again.
          void fetch().catch(() => null);
        }}
        className={shape}
      >
        {fetching === null ? (
          <VolumeX aria-hidden className="size-4" />
        ) : (
          <Spinner />
        )}
      </button>
    );
  }
  const mine = speaking === text;
  return (
    <button
      type="button"
      aria-label={mine ? t("speech.stop") : t("speech.listen")}
      onClick={() => {
        if (mine) {
          hush();
        } else {
          say(text);
        }
      }}
      className={cn(shape, mine && "text-accent-text")}
    >
      {mine ? (
        <Square aria-hidden className="size-3 fill-current" />
      ) : (
        <Volume2 aria-hidden className="size-4" />
      )}
    </button>
  );
}
