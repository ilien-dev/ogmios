import { grade } from "./grade";
import type { Grade } from "./grade";

/** How an answer went, or nothing judged: the answer was only shown. */
export type Tone = Grade | "neutral";

/** One voice of a chime: when it starts and how long it rings, in seconds. */
export interface Note {
  freq: number;
  at: number;
  dur: number;
  gain: number;
  wave: OscillatorType;
  /** The melody; the others only colour it. */
  lead: boolean;
}

function lead(
  freq: number,
  at: number,
  dur: number,
  gain: number,
  wave: OscillatorType = "triangle",
): Note {
  return { freq, at, dur, gain, wave, lead: true };
}

/** An octave over a note, quieter, so it rings through small speakers. */
function shine(note: Note, gain: number): Note {
  return { ...note, freq: note.freq * 2, gain, wave: "sine", lead: false };
}

function voiced(notes: Note[], gain: number): Note[] {
  return notes.flatMap((note) => [note, shine(note, gain)]);
}

/**
 * What each verdict sounds like, told apart with the eyes shut: right
 * rises, partial stays on its note, wrong falls, shown is one note alone.
 * All of it is high enough for a laptop's speakers and over in under half
 * a second, before the answer is read aloud.
 */
export const CHIMES: Record<Tone, Note[]> = {
  right: voiced([lead(784, 0, 0.16, 0.7), lead(1047, 0.09, 0.3, 0.7)], 0.25),
  partial: voiced([lead(659, 0, 0.14, 0.65), lead(659, 0.14, 0.26, 0.6)], 0.2),
  wrong: voiced(
    [lead(587, 0, 0.16, 0.6, "square"), lead(440, 0.13, 0.3, 0.6, "square")],
    0.2,
  ),
  neutral: voiced([lead(523, 0, 0.3, 0.65)], 0.3),
};

/** What the verdict on an answer says, as a sound and as a colour. */
export function verdictTone(
  result: { correct: boolean; helped?: boolean; understood?: unknown },
  unknown: boolean,
): Tone {
  if (unknown) {
    return "neutral";
  }
  if ((result.understood ?? null) !== null) {
    return "partial";
  }
  return grade(result.correct, result.helped === true);
}

interface Sound {
  context: AudioContext;
  out: AudioNode;
}

let sound: Sound | null = null;

/**
 * The audio, made or woken. Called from the key or the click that sends an
 * answer, before its verdict is awaited: a webview only lets sound start
 * from a gesture. Where there is no audio there is simply no sound.
 */
export function prime(): Sound | null {
  if (sound === null) {
    if (typeof globalThis.AudioContext !== "function") {
      return null;
    }
    const context = new AudioContext();
    // Loud, but the voices summed never clip.
    const squeeze = context.createDynamicsCompressor();
    squeeze.threshold.value = -10;
    squeeze.ratio.value = 4;
    const master = context.createGain();
    master.gain.value = 0.9;
    squeeze.connect(master).connect(context.destination);
    sound = { context, out: squeeze };
  }
  if (sound.context.state === "suspended") {
    void sound.context.resume();
  }
  return sound;
}

/** Plays the sound of a verdict. */
export function chime(tone: Tone): void {
  const ready = prime();
  if (ready === null) {
    return;
  }
  const { context, out } = ready;
  const start = context.currentTime + 0.01;
  for (const note of CHIMES[tone]) {
    const voice = context.createOscillator();
    const level = context.createGain();
    const at = start + note.at;
    voice.type = note.wave;
    voice.frequency.setValueAtTime(note.freq, at);
    // Square is the loudest wave for its gain: it is held lower to match.
    const peak = note.wave === "square" ? note.gain * 0.45 : note.gain;
    level.gain.setValueAtTime(0.0001, at);
    level.gain.exponentialRampToValueAtTime(peak, at + 0.01);
    level.gain.exponentialRampToValueAtTime(0.0001, at + note.dur);
    voice.connect(level).connect(out);
    voice.start(at);
    voice.stop(at + note.dur + 0.02);
  }
}
