/**
 * The mock's structures: `src-tauri/src/commands/structures.rs` in small.
 * The catalogue is the same thirty-six; a session warms up on the first
 * structure chosen and then goes round them in the order given, with no
 * draw, so a test knows what comes next. A sentence with a word has no
 * topic, and gets its own back when the word is dropped; every word fits
 * every structure here. A sentence of three words or more
 * has the structure; it has the word when it holds it as given. A session
 * finished with enough right makes its structures settle, and the mock has
 * no tomorrow: none is ever due.
 */
import type { Level } from "@shared/domain";
import type {
  ChapterStructure,
  ChapterStructures,
  StructureInfo,
  StructureItem,
  StructureResult,
  StructureSitting,
  StructureSummary,
  StructureVerdict,
  StructureWord,
  StructuresState,
  Topic,
} from "@shared/structures";
import { allMockChapters, mockBookTitle } from "./ipcMockBooks";
import { PracticeError } from "./ipcMockPractice";

const BY_LEVEL: Record<
  Level,
  ReadonlyArray<readonly [string, string, string]>
> = {
  basic: [
    ["present-simple", "Present simple", "She walks to work every day."],
    ["present-continuous", "Present continuous", "I'm reading a great book."],
    ["past-simple", "Past simple", "We watched a film last night."],
    ["was-were", "Was / were", "The food was really good."],
    ["going-to", "Going to", "I'm going to call her tomorrow."],
    ["will", "Will", "I'll help you with that."],
    ["can", "Can / can't", "I can't swim very well."],
    ["have-to", "Have to", "I have to get up early tomorrow."],
    ["would-like", "Would like", "I'd like to try that place."],
    ["there-is", "There is / there are", "There are two parks near my house."],
    ["comparatives", "Comparatives", "This phone is cheaper than mine."],
    ["superlatives", "Superlatives", "It's the best pizza in town."],
  ],
  intermediate: [
    ["present-perfect", "Present perfect", "I've been to Lisbon twice."],
    [
      "present-perfect-continuous",
      "Present perfect continuous",
      "I've been working here for two years.",
    ],
    ["past-continuous", "Past continuous", "I was cooking when you called."],
    ["past-perfect", "Past perfect", "She had already left when I got there."],
    ["used-to", "Used to", "I used to play the piano."],
    ["first-conditional", "First conditional", "If it rains, we'll stay home."],
    [
      "second-conditional",
      "Second conditional",
      "If I had more time, I'd travel more.",
    ],
    ["passive", "Passive", "The bridge was built in 1920."],
    [
      "relative-clauses",
      "Relative clauses",
      "The guy who lives next door is a chef.",
    ],
    ["reported-speech", "Reported speech", "He said he was tired."],
    [
      "modals-of-deduction",
      "Modals of deduction",
      "She must be at work by now.",
    ],
    [
      "verb-patterns",
      "Verb + -ing or to",
      "I enjoy cooking, but I forgot to buy rice.",
    ],
  ],
  advanced: [
    [
      "third-conditional",
      "Third conditional",
      "If I'd known, I would have come.",
    ],
    [
      "mixed-conditional",
      "Mixed conditional",
      "If I'd studied law, I'd be a lawyer now.",
    ],
    ["wish", "I wish", "I wish I'd studied more."],
    ["modal-perfect", "Modal perfect", "You should have told me."],
    [
      "future-continuous",
      "Future continuous",
      "This time tomorrow I'll be flying to Rome.",
    ],
    ["future-perfect", "Future perfect", "I'll have finished by Friday."],
    ["causative", "Causative", "I had my hair cut yesterday."],
    [
      "passive-reporting",
      "Passive reporting",
      "He's said to be the best in the country.",
    ],
    ["cleft", "Cleft sentences", "What I need is a long holiday."],
    ["inversion", "Inversion", "Never have I seen such a mess."],
    [
      "participle-clauses",
      "Participle clauses",
      "Walking home, I ran into an old friend.",
    ],
    ["would-rather", "Would rather", "I'd rather you didn't tell anyone."],
  ],
};

const LEVELS: readonly Level[] = ["basic", "intermediate", "advanced"];

const CATALOGUE = LEVELS.flatMap((level) =>
  BY_LEVEL[level].map(([key, name, example]) => ({
    key,
    level,
    name,
    example,
  })),
);

/** What the mock finds in any chapter, the most used first. */
const FOUND: readonly ChapterStructure[] = [
  {
    key: "past-simple",
    count: 212,
    example: "So she was considering in her own mind.",
  },
  {
    key: "past-continuous",
    count: 48,
    example: "Alice was beginning to get very tired.",
  },
  {
    key: "past-perfect",
    count: 37,
    example: "She had never before seen a rabbit with a waistcoat-pocket.",
  },
  { key: "relative-clauses", count: 31, example: "" },
];

const SIZES = [10, 20, 40, 60];
const WARM_PERCENT = 30;
const WARM_MIN = 3;
/** Words a sentence needs for the mock to find the structure in it. */
const ENOUGH_WORDS = 3;
const PASS_PERCENT = 80;
/** Words of the mock's chapter, of more than one kind. */
const WORDS: readonly StructureWord[] = [
  {
    english: "peep",
    source: "chapter",
    partOfSpeech: "verb",
    translations: ["asomarse", "echar un vistazo"],
  },
  {
    english: "tumble",
    source: "chapter",
    partOfSpeech: "verb",
    translations: ["caerse", "rodar"],
  },
  {
    english: "give up",
    source: "chapter",
    partOfSpeech: "phrasalVerb",
    translations: ["rendirse", "dejar"],
  },
  {
    english: "bank",
    source: "chapter",
    partOfSpeech: "noun",
    translations: ["orilla", "ribera"],
  },
];
const TOPICS = ["travel", "work", "food", "friends"];

interface Sentence extends StructureItem {
  /** What it is about when it is asked with no word. */
  about: Topic;
  retryOf: number | null;
  verdict: StructureVerdict | null;
}

interface Sitting {
  id: string;
  size: number;
  chapterId: string | null;
  sentences: Sentence[];
  finished: boolean;
}

let sittings: Map<string, Sitting> = new Map();
let settled: Set<string> = new Set();
let scanned: Set<string> = new Set();
let counter = 0;

/** Forgets every session, what settled and what was read. */
export function resetMockStructures(): void {
  sittings = new Map();
  settled = new Set();
  scanned = new Set();
  counter = 0;
}

function sittingOf(id: string): Sitting {
  const sitting = sittings.get(id);
  if (sitting === undefined) {
    throw new PracticeError("notFound", "session not found");
  }
  return sitting;
}

function chapterView(chapterId: string): ChapterStructures {
  const chapter = allMockChapters().find((each) => each.id === chapterId);
  if (chapter === undefined) {
    throw new PracticeError("notFound", "chapter not found");
  }
  const read = scanned.has(chapterId);
  return {
    bookTitle: mockBookTitle(chapterId),
    chapter,
    scanned: read,
    structures: read ? [...FOUND] : [],
  };
}

function state(): StructuresState {
  const [current] = allMockChapters();
  return {
    structures: CATALOGUE.map((each): StructureInfo => ({
      ...each,
      strength: settled.has(each.key) ? "settling" : "new",
      due: false,
    })),
    paused: [...sittings.values()]
      .filter((sitting) => !sitting.finished)
      .map((sitting) => ({
        id: sitting.id,
        startedAt: "2026-03-01T10:00:00.000Z",
        done: sitting.sentences.filter((each) => each.verdict !== null).length,
        total: sitting.sentences.length,
        structures: [
          ...new Set(sitting.sentences.map((each) => each.structure)),
        ],
      })),
    chapter: current === undefined ? null : chapterView(current.id),
  };
}

/** Pieces the mock reads of a chapter. */
const PIECES = 3;

function sentence(
  index: number,
  structure: string,
  warm: boolean,
  withWords: boolean,
): Sentence {
  const named = CATALOGUE.find((each) => each.key === structure);
  const about: Topic = {
    kind: "preset",
    key: TOPICS[index % TOPICS.length] ?? "travel",
  };
  const word = withWords ? (WORDS[index % WORDS.length] ?? null) : null;
  return {
    index,
    structure,
    name: named?.name ?? structure,
    level: named?.level ?? "basic",
    example: named?.example ?? "",
    about,
    topic: word === null ? about : null,
    word,
    warm,
    retryOf: null,
    verdict: null,
  };
}

function summary(sitting: Sitting): StructureSummary {
  const answered = sitting.sentences.filter((each) => each.verdict !== null);
  const of = (verdict: StructureVerdict): number =>
    answered.filter((each) => each.verdict === verdict).length;
  const keys = [...new Set(answered.map((each) => each.structure))];
  const tallies = keys.map((key) => {
    const own = answered.filter((each) => each.structure === key);
    return {
      key,
      right: own.filter((each) => each.verdict !== "wrong").length,
      total: own.length,
    };
  });
  return {
    correct: of("correct"),
    partial: of("partial"),
    wrong: of("wrong"),
    structures: [...tallies].sort(
      (a, b) => a.right * b.total - b.right * a.total,
    ),
  };
}

function view(sitting: Sitting): StructureSitting {
  const next = sitting.sentences.find((each) => each.verdict === null);
  return {
    id: sitting.id,
    size: sitting.size,
    structures: [...new Set(sitting.sentences.map((each) => each.structure))],
    chapterId: sitting.chapterId,
    done: sitting.sentences.filter((each) => each.verdict !== null).length,
    total: sitting.sentences.length,
    item:
      sitting.finished || next === undefined
        ? null
        : {
            index: next.index,
            structure: next.structure,
            name: next.name,
            level: next.level,
            example: next.example,
            topic: next.topic,
            word: next.word,
            warm: next.warm,
          },
    summary: sitting.finished ? summary(sitting) : null,
  };
}

function start(
  structures: readonly string[],
  size: number,
  chapterId: string | null,
): StructureSitting {
  const keys = [...new Set(structures)];
  const [first] = keys;
  if (
    first === undefined ||
    !SIZES.includes(size) ||
    keys.some((key) => !CATALOGUE.some((each) => each.key === key))
  ) {
    throw new PracticeError("invalid", "not a session");
  }
  const warm = Math.min(
    Math.max(Math.floor((size * WARM_PERCENT) / 100), WARM_MIN),
    size,
  );
  const withWords = allMockChapters().length > 0;
  counter += 1;
  const sitting: Sitting = {
    id: `structures-${String(counter)}`,
    size,
    chapterId,
    sentences: Array.from({ length: size }, (_, index) =>
      sentence(
        index,
        index < warm ? first : (keys[(index - warm) % keys.length] ?? first),
        index < warm,
        withWords,
      ),
    ),
    finished: false,
  };
  sittings.set(sitting.id, sitting);
  return view(sitting);
}

/** The sentence is asked without its word, about its topic. */
function dropWord(sittingId: string, index: number): StructureSitting {
  const sitting = sittingOf(sittingId);
  const asked = sitting.sentences.find((each) => each.index === index);
  if (asked === undefined || asked.verdict !== null) {
    throw new PracticeError("invalid", "no sentence to drop the word of");
  }
  asked.word = null;
  asked.topic = asked.about;
  return view(sitting);
}

/** The structures of a finished session that had enough right settle. */
function finish(sitting: Sitting): void {
  sitting.finished = true;
  for (const tally of summary(sitting).structures) {
    if (tally.right * 100 >= tally.total * PASS_PERCENT) {
      settled.add(tally.key);
    }
  }
}

function answer(
  sittingId: string,
  index: number,
  text: string,
  peeked: boolean,
): StructureResult {
  const sitting = sittingOf(sittingId);
  const asked = sitting.sentences.find((each) => each.index === index);
  if (sitting.finished || asked === undefined || asked.verdict !== null) {
    throw new PracticeError("invalid", "the sentence cannot be answered");
  }
  const written = text.trim();
  const has = written.split(/\s+/u).length >= ENOUGH_WORDS;
  const usedWord =
    asked.word === null ||
    written.toLowerCase().includes(asked.word.english.toLowerCase());
  let verdict: StructureVerdict = "correct";
  if (!has) {
    verdict = "wrong";
  } else if (!usedWord || (peeked && !asked.warm)) {
    verdict = "partial";
  }
  asked.verdict = verdict;
  const repeats =
    asked.retryOf !== null ||
    sitting.sentences.some((each) => each.retryOf === index);
  if (verdict === "wrong" && !repeats) {
    const again = sentence(
      sitting.sentences.length,
      asked.structure,
      false,
      asked.word !== null,
    );
    sitting.sentences.push({ ...again, retryOf: index });
  } else if (sitting.sentences.every((each) => each.verdict !== null)) {
    finish(sitting);
  }
  const named = CATALOGUE.find((each) => each.key === asked.structure);
  return {
    verdict,
    explanation:
      verdict === "wrong"
        ? "The structure is not there yet."
        : "The structure is there, well formed.",
    better: named?.example ?? "",
    usedWord,
  };
}

function close(sittingId: string, finished: boolean): null {
  const sitting = sittingOf(sittingId);
  if (sitting.sentences.every((each) => each.verdict === null)) {
    sittings.delete(sittingId);
  } else if (finished && !sitting.finished) {
    finish(sitting);
  }
  return null;
}

type After = <T>(ms: number, value: () => T) => Promise<T>;
type Emit = (event: string, payload: unknown) => void;

interface StartArgs {
  structures: string[];
  size: number;
  chapterId: string | null;
}

interface AnswerArgs {
  sittingId: string;
  index: number;
  answer: string;
  peeked: boolean;
}

export function structureCommands(
  after: After,
  emit: Emit,
): Record<string, (args: unknown) => Promise<unknown>> {
  /** Reads a chapter a piece at a time; one read already answers at once. */
  const scan = async (chapterId: string): Promise<ChapterStructures> => {
    if (chapterView(chapterId).scanned) {
      return after(100, () => chapterView(chapterId));
    }
    for (let done = 0; done <= PIECES; done += 1) {
      await after(done === 0 ? 0 : 700, () => {
        emit("structure-scan-progress", { chapterId, done, total: PIECES });
      });
    }
    scanned.add(chapterId);
    return chapterView(chapterId);
  };
  return {
    structures_state: () => after(120, state),
    scan_chapter_structures: (args) =>
      scan((args as { chapterId: string }).chapterId),
    start_structure_sitting: (args) =>
      after(150, () => {
        const { structures, size, chapterId } = args as StartArgs;
        return start(structures, size, chapterId);
      }),
    get_structure_sitting: (args) =>
      after(60, () => view(sittingOf((args as AnswerArgs).sittingId))),
    drop_structure_word: (args) =>
      after(60, () => {
        const sent = args as AnswerArgs;
        return dropWord(sent.sittingId, sent.index);
      }),
    answer_structure: (args) =>
      after(300, () => {
        const sent = args as AnswerArgs;
        return answer(sent.sittingId, sent.index, sent.answer, sent.peeked);
      }),
    close_structure_sitting: (args) =>
      after(60, () => {
        const sent = args as { sittingId: string; finished: boolean };
        return close(sent.sittingId, sent.finished);
      }),
  };
}
