import { useEffect, useRef, useState } from "react";
import type {
  SyntheticEvent,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Trash2 } from "lucide-react";
import type { Recording } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { countWords, WORDS_PER_SPEECH_SECOND } from "@/lib/text";
import { HelpPopover } from "./HelpPopover";
import { MicButton } from "./MicButton";
import { useRecorder } from "./useRecorder";

/** A press longer than this is push-to-talk; shorter ones toggle. */
const HOLD_MS = 350;

interface ComposerProps {
  sessionId: string | null;
  turnWordGoal: number;
  scaffolds: string[];
  voice: boolean;
  disabled: boolean;
  onSend: (text: string, recording: Recording | null) => Promise<boolean>;
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
 * The chat box at the foot of the conversation: text, microphone, the live
 * word meter, and "How do I say…?". A recording lands here as editable text;
 * what the recogniser heard travels with the turn as `recording.text`.
 */
export function Composer({
  sessionId,
  turnWordGoal,
  scaffolds,
  voice,
  disabled,
  onSend,
}: ComposerProps): ReactNode {
  const { t } = useTranslation();
  const recorder = useRecorder();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [sending, setSending] = useState(false);
  const pressedAt = useRef<number | null>(null);
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

  useEffect(() => {
    if (!voice) {
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
  }, [voice]);

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
    setSending(true);
    try {
      if (await onSend(sent, recording)) {
        setText("");
        setRecording(null);
        field.current?.focus();
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

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3"
    >
      {scaffolds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-faint">
            {t("conversation.scaffolds")}
          </span>
          {scaffolds.map((scaffold) => (
            <Chip
              key={scaffold}
              className="h-8"
              onClick={() => {
                setText((held) => appended(held, scaffold.replace(/…$/u, "")));
                field.current?.focus();
              }}
            >
              {scaffold}
            </Chip>
          ))}
        </div>
      )}
      <div
        className={cn(
          "relative overflow-visible rounded-xl border bg-surface shadow-card transition-colors duration-150 focus-within:border-line-strong",
          recording === null ? "border-line" : "border-accent-strong/60",
        )}
      >
        <div
          role="meter"
          aria-label={t("conversation.meterLabel")}
          aria-valuemin={0}
          aria-valuemax={turnWordGoal}
          aria-valuenow={Math.min(words, turnWordGoal)}
          aria-valuetext={t("conversation.meter", {
            count: words,
            goal: turnWordGoal,
          })}
          className="absolute inset-x-5 top-0 h-0.5 overflow-hidden rounded-full"
        >
          <div
            className="h-full origin-left bg-accent transition-transform duration-300 ease-out-expo"
            style={{ transform: `scaleX(${fill})` }}
          />
        </div>
        {recording !== null && (
          <div className="flex items-center justify-between gap-3 px-5 pt-3">
            <p className="text-sm text-accent-text">
              {t("conversation.transcriptHint")}
            </p>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 aria-hidden className="size-3.5" />}
              onClick={discard}
            >
              {t("conversation.discard")}
            </Button>
          </div>
        )}
        <label htmlFor="composer" className="sr-only">
          {t("conversation.composer")}
        </label>
        <textarea
          ref={field}
          id="composer"
          rows={3}
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
            "block w-full resize-none bg-transparent px-5 pt-4 text-lead focus-visible:outline-none",
            listening ? "text-ink-soft" : "text-ink",
          )}
        />
        <div className="flex items-center gap-2 px-3 pt-1 pb-3">
          {voice && (
            <MicButton
              status={recorder.status}
              peak={recorder.peak}
              disabled={disabled}
              onPress={press}
              onRelease={release}
              onKeyboardToggle={toggle}
            />
          )}
          <HelpPopover
            sessionId={sessionId}
            onInsert={(english) => {
              setText((held) => appended(held, english));
              field.current?.focus();
            }}
          />
          {recorder.status === "transcribing" && <Spinner />}
          <p
            aria-hidden
            className="ml-auto text-sm text-ink-faint tabular-nums"
          >
            {t("conversation.meter", { count: words, goal: turnWordGoal })}
          </p>
          <Button
            type="submit"
            variant="primary"
            aria-label={t("conversation.send")}
            disabled={
              disabled ||
              sending ||
              text.trim() === "" ||
              recorder.status !== "idle"
            }
            className="size-10 rounded-full px-0"
          >
            <ArrowUp aria-hidden className="size-5" />
          </Button>
        </div>
      </div>
      {recorder.error !== null && (
        <p role="alert" className="text-sm text-danger">
          {t("common.error", { message: recorder.error })}
        </p>
      )}
    </form>
  );
}
