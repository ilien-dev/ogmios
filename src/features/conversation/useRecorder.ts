import { useEffect, useRef, useState } from "react";
import type { Recording } from "@shared/domain";
import { errorMessage } from "@/lib/errors";
import {
  onSttLevel,
  onSttPartial,
  sttCancel,
  sttStart,
  sttStop,
} from "@/lib/ipc";

export type RecorderStatus = "idle" | "recording" | "transcribing";

export interface Recorder {
  status: RecorderStatus;
  /** Microphone peak, 0–1, for the live ring. */
  peak: number;
  /** Seconds with voice detected in the current recording. */
  speechSeconds: number;
  /** What the live preview has heard so far; kept until the final text lands. */
  partial: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<Recording | null>;
  cancel: () => Promise<void>;
}

/** The microphone, recorded and transcribed on the Rust side (§12). */
export function useRecorder(): Recorder {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [peak, setPeak] = useState(0);
  const [speechSeconds, setSpeechSeconds] = useState(0);
  const [partial, setPartial] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const statusRef = useRef<RecorderStatus>("idle");

  const move = (next: RecorderStatus): void => {
    statusRef.current = next;
    setStatus(next);
  };

  useEffect(() => {
    const unlisten = onSttLevel((level) => {
      if (statusRef.current === "recording") {
        setPeak(level.peak);
        setSpeechSeconds(level.speechSeconds);
      }
    });
    const unlistenPartial = onSttPartial((heard) => {
      if (statusRef.current === "recording") {
        setPartial(heard.text);
      }
    });
    return () => {
      if (statusRef.current === "recording") {
        void sttCancel();
      }
      for (const pending of [unlisten, unlistenPartial]) {
        void pending.then((stop) => {
          stop();
        });
      }
    };
  }, []);

  const start = async (): Promise<void> => {
    if (statusRef.current !== "idle") {
      return;
    }
    setFailure(null);
    setPeak(0);
    setSpeechSeconds(0);
    setPartial("");
    move("recording");
    try {
      await sttStart();
    } catch (error) {
      move("idle");
      setFailure(errorMessage(error));
    }
  };

  const stop = async (): Promise<Recording | null> => {
    if (statusRef.current !== "recording") {
      return null;
    }
    move("transcribing");
    setPeak(0);
    try {
      return await sttStop();
    } catch (error) {
      setFailure(errorMessage(error));
      return null;
    } finally {
      setPartial("");
      move("idle");
    }
  };

  const cancel = async (): Promise<void> => {
    if (statusRef.current === "recording") {
      move("idle");
      setPartial("");
      await sttCancel();
    }
  };

  return {
    status,
    peak,
    speechSeconds,
    partial,
    error: failure,
    start,
    stop,
    cancel,
  };
}
