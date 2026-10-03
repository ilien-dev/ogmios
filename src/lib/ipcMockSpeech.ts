/**
 * The mock's voice that reads aloud: `src-tauri/src/commands/tts.rs` in small.
 * Nothing is heard. Reading takes about as long as the text would, a download
 * reports `tts-download` on its way, and what was read is kept for the tests
 * to look at.
 */
import type { TtsDownload, TtsStatus, TtsVoice } from "@shared/domain";

type After = <T>(ms: number, value: () => T) => Promise<T>;
type Emit = (event: string, payload: unknown) => void;

const BYTES = 366_859_794;

const VOICES: TtsVoice[] = [
  { id: "af_heart", name: "Heart", variant: "us" },
  { id: "am_michael", name: "Michael", variant: "us" },
  { id: "bf_emma", name: "Emma", variant: "uk" },
  { id: "bm_george", name: "George", variant: "uk" },
];

/** About how long a character takes to say. */
const MS_PER_CHARACTER = 60;

let downloaded = false;
let voice = "af_heart";
let enabled = true;
let spoken: string[] = [];
/** Ends what is being read now; null while nothing is. */
let hush: (() => void) | null = null;

/** Back to a first launch, or to a learner whose voice is on disk. */
export function resetMockSpeech(ready = false): void {
  hush?.();
  hush = null;
  downloaded = ready;
  voice = "af_heart";
  enabled = true;
  spoken = [];
}

/** Everything read aloud since the last reset, oldest first. */
export function mockSpoken(): readonly string[] {
  return spoken;
}

function status(): TtsStatus {
  return {
    bytes: BYTES,
    downloaded,
    voices: VOICES.map((each) => ({ ...each })),
    voice,
    enabled,
  };
}

function field(args: unknown, name: string): unknown {
  return (args as Record<string, unknown>)[name];
}

export function speechCommands(
  after: After,
  emit: Emit,
): Record<string, (args: unknown) => Promise<unknown>> {
  const download = async (): Promise<void> => {
    const steps = 20;
    for (let step = 1; step <= steps; step += 1) {
      await after(120, () => null);
      emit("tts-download", {
        received: Math.round((BYTES * step) / steps),
        total: BYTES,
      } satisfies TtsDownload);
    }
    downloaded = true;
  };

  /** Like Rust: saying something new silences what was being said. */
  const speak = async (args: unknown): Promise<void> => {
    const text = (field(args, "text") as string).trim();
    hush?.();
    if (text === "") {
      return;
    }
    if (!downloaded) {
      throw new Error("the voice is not downloaded yet");
    }
    spoken.push(text);
    const cut: Promise<null> = new Promise((resolve) => {
      hush = () => {
        resolve(null);
      };
    });
    const silenced = hush;
    await Promise.race([
      after(text.length * MS_PER_CHARACTER, () => null),
      cut,
    ]);
    if (hush === silenced) {
      hush = null;
    }
  };

  return {
    tts_status: () => after(60, status),
    tts_download: download,
    tts_configure: (args) =>
      after(60, () => {
        voice = field(args, "voice") as string;
        enabled = field(args, "enabled") as boolean;
        if (!enabled) {
          hush?.();
        }
        return status();
      }),
    tts_speak: speak,
    tts_stop: () =>
      after(0, () => {
        hush?.();
        return null;
      }),
  };
}
