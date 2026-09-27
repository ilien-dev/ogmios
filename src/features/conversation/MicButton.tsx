import { useTranslation } from "react-i18next";
import { Mic, Square } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { RecorderStatus } from "./useRecorder";

interface MicButtonProps {
  status: RecorderStatus;
  peak: number;
  disabled: boolean;
  onPress: (event: PointerEvent<HTMLButtonElement>) => void;
  onRelease: () => void;
  onKeyboardToggle: () => void;
}

/**
 * Push-to-talk and toggle in one control: a long press records while held, a
 * short press starts and the next one stops. The ring grows with the voice.
 */
export function MicButton({
  status,
  peak,
  disabled,
  onPress,
  onRelease,
  onKeyboardToggle,
}: MicButtonProps): ReactNode {
  const { t } = useTranslation();
  const recording = status === "recording";
  return (
    <button
      type="button"
      disabled={disabled || status === "transcribing"}
      aria-pressed={recording}
      aria-label={
        recording ? t("conversation.micStop") : t("conversation.micHold")
      }
      onPointerDown={onPress}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onClick={(event) => {
        // `detail` is 0 for a click made with Enter or Space.
        if (event.detail === 0) {
          onKeyboardToggle();
        }
      }}
      className={cn(
        "relative grid size-11 shrink-0 touch-none place-items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:text-ink-faint",
        recording
          ? "bg-accent text-on-accent"
          : "bg-raised text-ink-soft hover:bg-line hover:text-ink",
      )}
    >
      {recording && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-accent-soft transition-transform duration-100"
          style={{ transform: `scale(${1 + peak * 0.6})` }}
        />
      )}
      {recording ? (
        <Square aria-hidden className="relative size-4 fill-current" />
      ) : (
        <Mic aria-hidden className="relative size-5" />
      )}
    </button>
  );
}
