/**
 * The mock's listening: `src-tauri/src/commands/listening.rs` in small.
 * Every chapter reads as the same few paragraphs, the ones the mock
 * translates, with no learned word marked. A dictation plays the sentences of them that are neither
 * short nor long, in the order of the text, with no draw, so a test knows
 * what comes next; none is kept for a word being reinforced. A word is
 * heard when it was typed anywhere in the answer, each typed word counting
 * for one of the sentence. A lost dictation suggests
 * slowing down; none suggests speeding up. Nothing is heard: reading takes
 * what the mock's voice takes, and what was read is kept there.
 */
import type {
  ChapterListening,
  ChapterReading,
  Dictation,
  DictationResult,
  DictationSummary,
  HeardWord,
  ListeningChapter,
  ListeningState,
  Pace,
  PaceStanding,
} from "@shared/listening";
import { PACES } from "@shared/listening";
import type { StructureVerdict } from "@shared/structures";
import { allMockChapters, mockBookId, mockBookTitle } from "./ipcMockBooks";
import { PracticeError } from "./ipcMockPractice";
import { mockSay, mockVoiceReady } from "./ipcMockSpeech";
import { mockEnglish } from "./ipcMockTranslate";

const SHORTEST = 6;
const LONGEST = 14;
const FREE_LISTENS = 2;
const ENOUGH = 10;
const HELD = 90;
const LOST = 60;
const MISSES = 3;
const STREAK = 3;

interface Sentence {
  sentence: string;
  retryOf: number | null;
  listens: number;
  first: Pace | null;
  pace: Pace | null;
  verdict: StructureVerdict | null;
  right: number;
  total: number;
}

interface Sitting {
  id: string;
  chapterId: string;
  pace: Pace;
  startedAt: string;
  finished: boolean;
  sentences: Sentence[];
}

let sittings: Map<string, Sitting> = new Map();
let places: Map<string, number> = new Map();
/** Every word dictated and whether it was typed, the oldest first. */
let words: Array<[word: string, heard: boolean]> = [];
/** Every sentence answered, the latest first. */
let log: Array<{ pace: Pace; right: number; total: number }> = [];
let counter = 0;

/** Forgets every dictation, what was heard and where each reading was left. */
export function resetMockListening(): void {
  sittings = new Map();
  places = new Map();
  words = [];
  log = [];
  counter = 0;
}

function key(word: string): string {
  return word
    .toLowerCase()
    .replaceAll(/[’‘]/gu, "'")
    .replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function keys(text: string): string[] {
  return text.split(/\s+/u).map(key).filter(Boolean);
}

function fits(sentence: string): boolean {
  const { length } = keys(sentence);
  return length >= SHORTEST && length <= LONGEST;
}

function rank(pace: Pace): number {
  return PACES.indexOf(pace);
}

function percent(right: number, total: number): number {
  return total === 0 ? 0 : (right * 100) / total;
}

function standings(): PaceStanding[] {
  return PACES.map((pace) => {
    const latest = log.filter((heard) => heard.pace === pace).slice(0, 30);
    const right = latest.reduce((sum, heard) => sum + heard.right, 0);
    const total = latest.reduce((sum, heard) => sum + heard.total, 0);
    return {
      pace,
      right,
      total,
      sentences: latest.length,
      held: latest.length >= ENOUGH && percent(right, total) >= HELD,
    };
  });
}

function understood(): Pace | null {
  // Slowest first: the last one held is the fastest.
  const fastest = standings()
    .reverse()
    .find((each) => each.held);
  return fastest?.pace ?? null;
}

/** By word: how often it was missed, and how often heard running since. */
function tallies(): Map<string, [misses: number, streak: number]> {
  const found: Map<string, [number, number]> = new Map();
  for (const [word, heard] of words) {
    const [misses, streak] = found.get(word) ?? [0, 0];
    found.set(word, heard ? [misses, streak + 1] : [misses + 1, 0]);
  }
  return found;
}

function sittingOf(id: string): Sitting {
  const sitting = sittings.get(id);
  if (sitting === undefined) {
    throw new PracticeError("notFound", "dictation not found");
  }
  return sitting;
}

function chapterView(chapterId: string): ListeningChapter {
  const chapter = allMockChapters().find((each) => each.id === chapterId);
  if (chapter === undefined) {
    throw new PracticeError("notFound", "chapter not found");
  }
  return {
    bookId: mockBookId(chapterId),
    bookTitle: mockBookTitle(chapterId),
    chapter,
    sentences: mockEnglish().flat().length,
    place: places.get(chapterId) ?? 0,
  };
}

function state(chapterId: string | null): ListeningState {
  const held = understood();
  const missed = [...tallies()]
    .map(([word, [times, streak]]) => ({ word, times, streak }))
    .sort((a, b) => b.times - a.times);
  const on = chapterId ?? allMockChapters()[0]?.id ?? null;
  return {
    understood: held,
    pace: held === null ? "normal" : (PACES[rank(held) + 1] ?? held),
    standings: standings(),
    missed: missed
      .filter((each) => each.times >= 2)
      .slice(0, 6)
      .map(({ word, times }) => ({ word, times })),
    reinforced: missed
      .filter((each) => each.times >= MISSES && each.streak < STREAK)
      .slice(0, 5)
      .map((each) => each.word),
    paused: [...sittings.values()]
      .filter((sitting) => !sitting.finished)
      .map((sitting) => ({
        id: sitting.id,
        startedAt: sitting.startedAt,
        done: sitting.sentences.filter((each) => each.verdict !== null).length,
        total: sitting.sentences.length,
      })),
    chapter: on === null ? null : chapterView(on),
  };
}

function reading(chapterId: string): ChapterReading {
  const on = chapterView(chapterId);
  return {
    bookId: on.bookId,
    bookTitle: on.bookTitle,
    chapter: on.chapter,
    paragraphs: mockEnglish().map((paragraph) =>
      paragraph.map((sentence) => [{ text: sentence, marked: false }]),
    ),
    place: on.place,
  };
}

function summary(sitting: Sitting): DictationSummary {
  const done = sitting.sentences.filter((each) => each.verdict !== null);
  const worth = (verdict: StructureVerdict): number =>
    done.filter((each) => each.verdict === verdict).length;
  const right = done.reduce((sum, each) => sum + each.right, 0);
  const total = done.reduce((sum, each) => sum + each.total, 0);
  const at = (pace: Pace): number =>
    done.filter((each) => each.pace === pace).length;
  const pace = PACES.reduce<Pace>(
    (most, each) => (at(each) > at(most) ? each : most),
    sitting.pace,
  );
  return {
    correct: worth("correct"),
    partial: worth("partial"),
    wrong: worth("wrong"),
    right,
    total,
    pace,
    hint: percent(right, total) < LOST && pace !== "slow" ? "slower" : null,
    understood: understood(),
  };
}

function view(sitting: Sitting): Dictation {
  const index = sitting.sentences.findIndex((each) => each.verdict === null);
  const next = sitting.sentences[index];
  return {
    id: sitting.id,
    chapterId: sitting.chapterId,
    pace: sitting.pace,
    done: sitting.sentences.filter((each) => each.verdict !== null).length,
    total: sitting.sentences.length,
    item:
      next === undefined || sitting.finished
        ? null
        : {
            index,
            listens: next.listens,
            pace: next.pace,
            retry: next.retryOf !== null,
          },
    summary: sitting.finished ? summary(sitting) : null,
  };
}

function asked(sentence: string, retryOf: number | null): Sentence {
  return {
    sentence,
    retryOf,
    listens: 0,
    first: null,
    pace: null,
    verdict: null,
    right: 0,
    total: 0,
  };
}

function start(chapterId: string, pace: Pace): Dictation {
  chapterView(chapterId);
  counter += 1;
  const sitting: Sitting = {
    id: `dictation-${counter}`,
    chapterId,
    pace,
    startedAt: new Date().toISOString(),
    finished: false,
    sentences: mockEnglish()
      .flat()
      .filter(fits)
      .map((sentence) => asked(sentence, null)),
  };
  sittings.set(sitting.id, sitting);
  return view(sitting);
}

/** The sentence still to be answered at `index`. */
function open(sitting: Sitting, index: number): Sentence {
  const sentence = sitting.sentences[index];
  if (sitting.finished || sentence === undefined || sentence.verdict !== null) {
    throw new PracticeError("invalid", "no sentence to answer");
  }
  return sentence;
}

function hear(sittingId: string, index: number, pace: Pace): string {
  const sentence = open(sittingOf(sittingId), index);
  sentence.listens += 1;
  sentence.first ??= pace;
  sentence.pace =
    sentence.pace === null || rank(pace) < rank(sentence.pace)
      ? pace
      : sentence.pace;
  return sentence.sentence;
}

function answer(
  sittingId: string,
  index: number,
  text: string,
  chosen: Pace,
): DictationResult {
  const sitting = sittingOf(sittingId);
  const sentence = open(sitting, index);
  const typed = keys(text);
  const left = [...typed];
  const heard: HeardWord[] = sentence.sentence.split(/\s+/u).map((word) => {
    const at = left.indexOf(key(word));
    if (at !== -1) {
      left.splice(at, 1);
    }
    return { text: word, heard: at !== -1 };
  });
  const whole =
    heard.every((word) => word.heard) && typed.length === heard.length;
  const slowed =
    sentence.first !== null &&
    sentence.pace !== null &&
    rank(sentence.pace) < rank(sentence.first);
  const helped = sentence.listens > FREE_LISTENS || slowed;
  let verdict: StructureVerdict = "wrong";
  if (whole) {
    verdict = helped ? "partial" : "correct";
  }
  sentence.verdict = verdict;
  sentence.pace ??= chosen;
  sentence.right = heard.filter((word) => word.heard).length;
  sentence.total = heard.length;
  log.unshift({
    pace: sentence.pace,
    right: sentence.right,
    total: sentence.total,
  });
  for (const word of heard) {
    words.push([key(word.text), word.heard]);
  }
  if (verdict === "wrong" && sentence.retryOf === null) {
    sitting.sentences.push(asked(sentence.sentence, index));
  } else if (sitting.sentences.every((each) => each.verdict !== null)) {
    sitting.finished = true;
  }
  return {
    verdict,
    sentence: sentence.sentence,
    words: heard,
    listens: sentence.listens,
    slowed,
  };
}

function close(sittingId: string, finished: boolean): null {
  const sitting = sittingOf(sittingId);
  if (sitting.sentences.every((each) => each.verdict === null)) {
    sittings.delete(sittingId);
  } else if (finished) {
    sitting.finished = true;
  }
  return null;
}

type After = <T>(ms: number, value: () => T) => Promise<T>;
type Emit = (event: string, payload: unknown) => void;

interface Sent {
  sittingId: string;
  chapterId: string;
  index: number;
  from: number;
  pace: Pace;
  answer: string;
  finished: boolean;
}

export function listeningCommands(
  after: After,
  emit: Emit,
): Record<string, (args: unknown) => Promise<unknown>> {
  /** Reads on from a sentence until the last, or until it is talked over. */
  const listen = async (chapterId: string, from: number): Promise<boolean> => {
    const sentences = mockEnglish().flat();
    for (const [sentence, text] of sentences.entries()) {
      if (sentence >= from) {
        places.set(chapterId, sentence);
        emit("chapter-listening", {
          chapterId,
          sentence,
        } satisfies ChapterListening);
        if (!(await mockSay(after, text))) {
          return false;
        }
      }
    }
    places.set(chapterId, 0);
    return true;
  };
  return {
    listening_state: (args) =>
      after(120, () => state((args as { chapterId: string | null }).chapterId)),
    chapter_reading: (args) =>
      after(120, () => reading((args as Sent).chapterId)),
    listen_chapter: (args) => {
      const sent = args as Sent;
      return listen(sent.chapterId, sent.from);
    },
    start_dictation: (args) =>
      after(150, () => {
        const sent = args as Sent;
        return start(sent.chapterId, sent.pace);
      }),
    get_dictation: (args) =>
      after(60, () => view(sittingOf((args as Sent).sittingId))),
    hear_dictation: async (args) => {
      const sent = args as Sent;
      if (!mockVoiceReady()) {
        throw new Error("the voice is not downloaded yet");
      }
      await mockSay(after, hear(sent.sittingId, sent.index, sent.pace));
      return view(sittingOf(sent.sittingId));
    },
    answer_dictation: (args) =>
      after(80, () => {
        const sent = args as Sent;
        return answer(sent.sittingId, sent.index, sent.answer, sent.pace);
      }),
    close_dictation: (args) =>
      after(60, () => {
        const sent = args as Sent;
        return close(sent.sittingId, sent.finished);
      }),
  };
}
