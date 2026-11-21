import { useTransform } from "motion/react";
import type { MotionValue } from "motion/react";
import { useTranslation } from "react-i18next";
import { Mic, Square } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import type { RecorderStatus } from "./useRecorder";

/** The ring around a recording mic, as a scale of the button, at full voice. */
const RING_LOUDEST = 1.6;

interface MicButtonProps {
  status: RecorderStatus;
  level: MotionValue<number>;
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
  level,
  disabled,
  onPress,
  onRelease,
  onKeyboardToggle,
}: MicButtonProps): ReactNode {
  const { t } = useTranslation();
  const recording = status === "recording";
  const ring = useTransform(level, [0, 1], [1, RING_LOUDEST]);
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
        "group relative grid size-14 shrink-0 touch-none place-items-center rounded-full transition-control hover:enabled:-translate-y-0.5 disabled:cursor-not-allowed disabled:text-ink-faint",
        recording
          ? "bg-ink text-canvas"
          : "text-on-cta ring-6 ring-mint/20 bg-cta hover:enabled:ring-mint/30 disabled:bg-raised disabled:bg-none disabled:ring-0",
      )}
    >
      <Presence>
        {recording && (
          <Reveal
            key="ring"
            as="span"
            kind="fade"
            index={0}
            aria-hidden
            style={{ scale: ring }}
            className="absolute inset-0 rounded-full bg-accent-soft"
          >
            <span className="absolute -inset-1 animate-breathe rounded-full border border-mint/60" />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {recording ? (
          <Reveal
            key="stop"
            as="span"
            kind="scale"
            index={0}
            className="relative col-start-1 row-start-1"
          >
            <Square aria-hidden className="size-4 fill-current" />
          </Reveal>
        ) : (
          <Reveal
            key="mic"
            as="span"
            kind="scale"
            index={0}
            className="relative col-start-1 row-start-1"
          >
            <Mic
              aria-hidden
              className="size-6 transition-transform duration-300 ease-out-expo group-enabled:group-hover:scale-110"
            />
          </Reveal>
        )}
      </Presence>
    </button>
  );
}
