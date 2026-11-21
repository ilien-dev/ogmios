import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type {
  SyntheticEvent,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { useScreenLeaving } from "@/lib/motion";
import { ArrowUp, Trash2 } from "lucide-react";
import type { Recording } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { countWords, WORDS_PER_SPEECH_SECOND } from "@/lib/text";
import { MicButton } from "./MicButton";
import type { RecorderStatus } from "./useRecorder";
import { useRecorder } from "./useRecorder";

/** What the screen around the composer may do with it. */
export interface ComposerHandle {
  /** Adds words at the end of the answer, as "How do I say…?" does. */
  insert: (words: string) => void;
}

/** A press longer than this is push-to-talk; shorter ones toggle. */
const HOLD_MS = 350;

interface ComposerProps {
  turnWordGoal: number;
  scaffolds: string[];
  voice: boolean;
  disabled: boolean;
  onSend: (text: string, recording: Recording | null) => Promise<boolean>;
  /** Tells what the microphone is doing whenever that changes. */
  onStatus?: (status: RecorderStatus) => void;
  /** Tells how many words this turn holds whenever that changes. */
  onWords?: (words: number) => void;
  ref?: Ref<ComposerHandle>;
}

function merge(held: Recording | null, next: Recording): Recording {
  if (held === null) {
    return next;
  }
  return {
    text: `${held.text} ${next.text}`,
    audioId: next.audioId,
    speechSeconds: held.speechSeconds + next.speechSeconds,
  };
}

function appended(held: string, addition: string): string {
  const trimmed = held.trimEnd();
  return trimmed === "" ? addition : `${trimmed} ${addition}`;
}

function isShortcut(event: globalThis.KeyboardEvent): boolean {
  return event.ctrlKey && event.code === "Space";
}

/**
 * The glass panel at the foot of the conversation: the answer, the
 * microphone, sending, and the turn's word meter. A recording lands here as editable text;
 * what the recogniser heard travels with the turn as `recording.text`.
 */
export function Composer({
  turnWordGoal,
  scaffolds,
  voice,
  disabled,
  onSend,
  onStatus,
  onWords,
  ref,
}: ComposerProps): ReactNode {
  const { t } = useTranslation();
  const recorder = useRecorder();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [sending, setSending] = useState(false);
  const pressedAt = useRef<number | null>(null);
  const leaving = useScreenLeaving();
  const field = useRef<HTMLTextAreaElement>(null);

  const absorb = (next: Recording | null): void => {
    if (next === null) {
      return;
    }
    setText((held) => appended(held, next.text));
    setRecording((held) => merge(held, next));
    field.current?.focus();
  };

  const begin = (): void => {
    pressedAt.current = Date.now();
    void recorder.start();
  };

  const finish = (): void => {
    pressedAt.current = null;
    void recorder.stop().then(absorb);
  };

  const toggle = (): void => {
    if (recorder.status === "idle") {
      begin();
      pressedAt.current = null;
    } else if (recorder.status === "recording") {
      finish();
    }
  };

  const release = (): void => {
    const at = pressedAt.current;
    if (at !== null && Date.now() - at > HOLD_MS) {
      finish();
    }
    pressedAt.current = null;
  };

  const press = (event: PointerEvent<HTMLButtonElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    if (recorder.status === "idle") {
      begin();
    } else if (recorder.status === "recording") {
      finish();
    }
  };

  const status = useRef(recorder.status);
  status.current = recorder.status;

  useImperativeHandle(
    ref,
    () => ({
      insert: (words: string) => {
        setText((held) => appended(held, words));
        field.current?.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    onStatus?.(recorder.status);
  }, [onStatus, recorder.status]);

  useEffect(() => {
    if (!voice || leaving) {
      return;
    }
    const down = (event: globalThis.KeyboardEvent): void => {
      if (!isShortcut(event)) {
        return;
      }
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      if (status.current === "idle") {
        begin();
      } else if (status.current === "recording") {
        finish();
      }
    };
    const up = (event: globalThis.KeyboardEvent): void => {
      if (event.code === "Space") {
        release();
      }
    };
    globalThis.addEventListener("keydown", down);
    globalThis.addEventListener("keyup", up);
    return () => {
      globalThis.removeEventListener("keydown", down);
      globalThis.removeEventListener("keyup", up);
    };
  }, [voice, leaving]);

  const discard = (): void => {
    void recorder.cancel();
    setRecording(null);
    setText("");
    field.current?.focus();
  };

  const submit = async (event?: SyntheticEvent): Promise<void> => {
    event?.preventDefault();
    const sent = text.trim();
    if (sent === "" || disabled || sending || recorder.status !== "idle") {
      return;
    }
    // Clear now: `onSend` resolves only once the partner's reply is complete.
    const held = recording;
    setSending(true);
    setText("");
    setRecording(null);
    field.current?.focus();
    try {
      const ok = await onSend(sent, held);
      // A failed turn comes back, unless the learner has started a new one.
      if (!ok && (field.current?.value ?? "").trim() === "") {
        setText(sent);
        setRecording(held);
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  const listening = recorder.status !== "idle";
  const shown =
    listening && recorder.partial !== ""
      ? appended(text, recorder.partial)
      : text;
  const spoken =
    recorder.status === "recording" && recorder.partial === ""
      ? recorder.speechSeconds * WORDS_PER_SPEECH_SECOND
      : 0;
  const words = Math.round(countWords(shown) + spoken);
  const fill = Math.min(1, words / Math.max(1, turnWordGoal));
  const meter = t("conversation.meter", { count: words, goal: turnWordGoal });

  useEffect(() => {
    onWords?.(words);
  }, [onWords, words]);

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3 rounded-xl glass px-4.5 py-4"
    >
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="composer" className="text-sm text-ink-soft">
          {t("conversation.composer")}
        </label>
        <p
          aria-hidden
          className="font-mono text-xs text-ink-faint tabular-nums"
        >
          {meter}
        </p>
      </div>
      <Presence>
        {scaffolds.length > 0 && (
          <Reveal
            key="scaffolds"
            kind="fade"
            index={0}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-sm text-partner">
              {t("conversation.scaffolds")}
            </span>
            <Presence>
              {scaffolds.map((scaffold, i) => (
                <Reveal key={scaffold} as="span" kind="scale" index={i + 1}>
                  <Chip
                    className="h-8 bg-partner-soft text-partner hover:-translate-y-0.5 hover:bg-partner-line hover:text-partner"
                    onClick={() => {
                      setText((held) =>
                        appended(held, scaffold.replace(/…$/u, "")),
                      );
                      field.current?.focus();
                    }}
                  >
                    {scaffold}
                  </Chip>
                </Reveal>
              ))}
            </Presence>
          </Reveal>
        )}
        {recording !== null && (
          <Reveal
            key="transcript"
            index={0}
            className="flex items-center justify-between gap-3"
          >
            <p className="text-sm text-accent-text">
              {t("conversation.transcriptHint")}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="group"
              icon={
                <Trash2
                  aria-hidden
                  className="size-3.5 transition-transform duration-300 ease-out-expo group-hover:-rotate-12"
                />
              }
              onClick={discard}
            >
              {t("conversation.discard")}
            </Button>
          </Reveal>
        )}
      </Presence>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-sunken/60 px-4 transition-colors duration-300 ease-out-expo",
            recording === null
              ? "border-line-strong/60 focus-within:border-you-line"
              : "border-you-line",
          )}
        >
          <textarea
            ref={field}
            id="composer"
            rows={1}
            value={shown}
            readOnly={listening}
            placeholder={
              recorder.status === "recording"
                ? t("conversation.recording")
                : recorder.status === "transcribing"
                  ? t("conversation.transcribing")
                  : t("conversation.placeholder")
            }
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              "block field-sizing-content max-h-40 min-h-13 min-w-0 flex-1 resize-none bg-transparent py-3.5 text-lead focus-visible:outline-none",
              listening ? "text-ink-soft" : "text-ink",
            )}
          />
          <Presence>
            {recorder.status === "transcribing" && (
              <Reveal key="transcribing" as="span" kind="fade" index={0}>
                <Spinner />
              </Reveal>
            )}
          </Presence>
        </div>
        <Presence>
          {voice && (
            <Reveal key="mic" kind="scale">
              <MicButton
                status={recorder.status}
                level={recorder.level}
                disabled={disabled}
                onPress={press}
                onRelease={release}
                onKeyboardToggle={toggle}
              />
            </Reveal>
          )}
        </Presence>
        <button
          type="submit"
          aria-label={t("conversation.send")}
          disabled={
            disabled ||
            sending ||
            text.trim() === "" ||
            recorder.status !== "idle"
          }
          className={cn(
            "group grid size-14 shrink-0 place-items-center rounded-full transition-control hover:enabled:-translate-y-0.5 hover:enabled:shadow-lift disabled:cursor-not-allowed disabled:text-ink-faint",
            voice
              ? "glass text-ink"
              : "animate-shimmer text-on-cta bg-cta disabled:bg-raised disabled:bg-none",
          )}
        >
          <ArrowUp
            aria-hidden
            className="size-5 transition-transform duration-300 ease-out-expo group-enabled:group-hover:-translate-y-0.5"
          />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="font-mono text-xs text-ink-faint uppercase"
        >
          {t("conversation.turn")}
        </span>
        <div
          role="meter"
          aria-label={t("conversation.meterLabel")}
          aria-valuemin={0}
          aria-valuemax={turnWordGoal}
          aria-valuenow={Math.min(words, turnWordGoal)}
          aria-valuetext={meter}
          className="h-1 flex-1 overflow-hidden rounded-full bg-line-strong/60"
        >
          <div
            className="h-full origin-left rounded-full bg-mint transition-transform duration-300 ease-out-expo"
            style={{ transform: `scaleX(${String(fill)})` }}
          />
        </div>
      </div>
      <Presence>
        {recorder.error !== null && (
          <Reveal
            key="error"
            as="p"
            index={0}
            role="alert"
            className="text-sm text-danger"
          >
            {t("common.error", { message: recorder.error })}
          </Reveal>
        )}
      </Presence>
    </form>
  );
}
