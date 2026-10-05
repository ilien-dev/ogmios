/**
 * The mock's prepared chapters: what `prepare_chapter` finds at each depth,
 * the `chapter-progress` events it reports on the way, and the one chapter
 * that fails the first time it is asked so the retry can be seen.
 */
import type {
  BookWord,
  Chapter,
  ChapterProgress,
  ChapterRefusal,
  ChapterWords,
  Depth,
  KnownWord,
  PartOfSpeech,
} from "@shared/domain";
import { READY } from "@shared/domain";
import {
  allMockChapters,
  findMockChapter,
  setMockChapterPrepared,
} from "./ipcMockBooks";
import {
  isMockWordDone,
  isMockWordKnown,
  mockKnownLemmas,
  mockWordHalf,
  mockWordStrength,
  resetMockWords,
  setMockWordDone,
  setMockWordKnown,
} from "./ipcMockWords";

type Entry = [
  lemma: string,
  translations: string[],
  count: number,
  partOfSpeech: PartOfSpeech,
];

/** The words each depth brings in that the shallower ones did not. */
const FOUND: Record<Depth, Entry[]> = {
  hardest: [
    ["peep", ["asomarse", "echar un vistazo"], 2, "verb"],
    ["waistcoat", ["chaleco"], 3, "noun"],
    ["hedge", ["seto"], 1, "noun"],
    ["marmalade", ["mermelada"], 2, "noun"],
  ],
  relevant: [
    ["rabbit hole", ["madriguera"], 6, "noun"],
    ["tumble", ["caerse", "rodar"], 4, "verb"],
    ["curtsey", ["hacer una reverencia", "reverencia"], 3, "verb"],
    ["give up", ["rendirse", "dejar"], 2, "phrasalVerb"],
  ],
  most: [
    ["bank", ["orilla", "ribera"], 5, "noun"],
    ["daisy", ["margarita"], 3, "noun"],
    ["cupboard", ["armario", "alacena"], 2, "noun"],
    ["shelf", ["estante", "repisa"], 2, "noun"],
  ],
};

/** Shallowest first: preparing at one depth brings in all before it too. */
const DEPTHS: readonly Depth[] = ["hardest", "relevant", "most"];
/** The pieces the mock chapter is read in. */
const PIECES = 3;
/** The chapter `seedMockLongChapter` prepares with every word there is. */
const LONG_CHAPTER = "book-alice-3";
/** The chapter whose first preparation fails. */
const FLAKY_CHAPTER = "book-alice-4";

let words: Map<string, BookWord[]> = new Map();
/** The ids of the words left to learn in a sorting of their list. */
let sorted: Set<string> = new Set();
let failed: Set<string> = new Set();
let refusal: ChapterRefusal | null = null;
/** The words are as stored before words were labelled: of no kind yet. */
let unlabelled = false;

/** The `invalid` or `provider` error `prepare_chapter` rejects with. */
class ChapterError extends Error {
  readonly kind: "invalid" | "notFound" | "provider";

  constructor(kind: ChapterError["kind"], message: string) {
    super(message);
    this.name = "ChapterError";
    this.kind = kind;
  }
}

function wordsUpTo(chapterId: string, depth: Depth): BookWord[] {
  return DEPTHS.slice(0, DEPTHS.indexOf(depth) + 1)
    .flatMap((each) => FOUND[each])
    .map(([lemma, translations, count, partOfSpeech]) => ({
      id: `${chapterId}-${lemma.replaceAll(" ", "-")}`,
      lemma,
      partOfSpeech,
      translations: [...translations],
      count,
      done: false,
      strength: null,
      half: null,
      known: false,
      sorted: false,
    }));
}

function byCount(list: BookWord[]): BookWord[] {
  return [...list].sort(
    (a, b) => b.count - a.count || a.lemma.localeCompare(b.lemma),
  );
}

/** Forgets what was prepared since the shelf was last filled. */
export function resetMockChapters(): void {
  words = new Map();
  sorted = new Set();
  failed = new Set();
  refusal = null;
  unlabelled = false;
  resetMockWords();
}

/**
 * Every word is as it was stored before words were labelled, until
 * `label_words` says what kind each is.
 */
export function seedMockUnlabelled(): void {
  unlabelled = true;
}

/** The next `prepare_chapter` is refused for this reason, once. */
export function setMockChapterRefusal(why: ChapterRefusal | null): void {
  refusal = why;
}

/** The chapter's words as they stand: finished, known, or neither yet. */
function wordsOf(chapter: Chapter): BookWord[] {
  // A chapter the shelf came with prepared has the words of its depth.
  const seeded =
    chapter.prepared === null
      ? []
      : byCount(wordsUpTo(chapter.id, chapter.prepared));
  return (words.get(chapter.id) ?? seeded).map((word) => {
    const done = isMockWordDone(word.id);
    const known = isMockWordKnown(word.lemma);
    return {
      ...word,
      partOfSpeech: unlabelled ? null : word.partOfSpeech,
      done,
      strength: done && !known ? mockWordStrength(word.lemma) : null,
      half: mockWordHalf(word.id),
      known,
      sorted: sorted.has(word.id),
    };
  });
}

/**
 * The chapter with its readiness: the share of its words done or known,
 * rounded down, as `books::practice::readiness` counts it.
 */
export function withMockReadiness(chapter: Chapter): Chapter {
  if (chapter.prepared === null) {
    return { ...chapter, readiness: null };
  }
  const list = wordsOf(chapter);
  const settled = list.filter((word) => word.done || word.known).length;
  const readiness =
    settled >= list.length
      ? READY
      : Math.floor((settled * READY) / list.length);
  return { ...chapter, readiness };
}

function chapterWords(id: string): ChapterWords {
  const chapter = findMockChapter(id);
  if (chapter === undefined) {
    throw new ChapterError("notFound", "chapter not found");
  }
  return { chapter: withMockReadiness(chapter), words: wordsOf(chapter) };
}

/** Every finished word on the shelf, once each. */
export function mockLearnedWords(): BookWord[] {
  const learned: Map<string, BookWord> = new Map();
  for (const word of allMockChapters().flatMap(wordsOf)) {
    if (word.done && !learned.has(word.lemma)) {
      learned.set(word.lemma, word);
    }
  }
  return [...learned.values()];
}

/**
 * Chapters in more states than the shelf comes with, for `?mock=ready` and
 * the tests that ask for them: "II" ready to read, with three words done and
 * the fourth known already, "III" partly done, and that known word in "I".
 */
export function seedMockReadiness(): void {
  const finish = (id: string, depth: Depth, count: number): void => {
    setMockChapterPrepared(id, depth);
    for (const word of byCount(wordsUpTo(id, depth)).slice(0, count)) {
      setMockWordDone(word.id);
    }
  };
  finish("book-alice-1", "hardest", FOUND.hardest.length - 1);
  finish("book-alice-2", "relevant", FOUND.hardest.length + 1);
  setMockWordKnown("hedge", true);
}

/**
 * A chapter with more words to practise than the smallest session takes, so
 * that "Practice" on it offers a choice of sizes: "IV" at the widest depth,
 * twelve words. For `?mock=ready` and the tests that ask for it.
 */
export function seedMockLongChapter(): void {
  setMockChapterPrepared(LONG_CHAPTER, "most");
}

try {
  if (new URLSearchParams(globalThis.location.search).get("mock") === "ready") {
    seedMockReadiness();
    seedMockLongChapter();
  }
} catch {
  // No location outside a browser: the chapters start as the shelf has them.
}

/** Marks a word as known, or takes that back; its chapter after it. */
function setKnown(wordId: string, known: boolean): ChapterWords {
  for (const chapter of allMockChapters()) {
    const word = wordsOf(chapter).find((each) => each.id === wordId);
    if (word !== undefined) {
      setMockWordKnown(word.lemma, known);
      return chapterWords(chapter.id);
    }
  }
  throw new ChapterError("notFound", "word not found");
}

/** Keeps a word as left to learn in a sorting, or takes that back. */
function setSorted(wordId: string, left: boolean): ChapterWords {
  for (const chapter of allMockChapters()) {
    if (wordsOf(chapter).some((each) => each.id === wordId)) {
      if (left) {
        sorted.add(wordId);
      } else {
        sorted.delete(wordId);
      }
      return chapterWords(chapter.id);
    }
  }
  throw new ChapterError("notFound", "word not found");
}

/** Has the chapter's list to be sorted again from its first word. */
function restartSorting(id: string): ChapterWords {
  for (const word of chapterWords(id).words) {
    sorted.delete(word.id);
  }
  return chapterWords(id);
}

/** Every word marked as known, the latest first; its base form is its key. */
function knownWords(): KnownWord[] {
  const found = Object.values(FOUND).flat();
  return mockKnownLemmas().map((lemma) => ({
    key: lemma,
    lemma,
    translations: [...(found.find(([each]) => each === lemma)?.[1] ?? [])],
  }));
}

/** The words a chapter has so far, most frequent first. */
export function mockChapterWords(id: string): BookWord[] {
  return chapterWords(id).words;
}

/** What stops this preparation, if anything does. */
function checkCanPrepare(id: string): void {
  if (refusal !== null) {
    const why = refusal;
    refusal = null;
    throw new ChapterError("invalid", why);
  }
  if (id === FLAKY_CHAPTER && !failed.has(id)) {
    failed.add(id);
    throw new ChapterError("provider", "Claude took too long to answer");
  }
}

function arg(args: unknown, key: "id" | "depth" | "wordId" | "key"): string {
  return String((args as Record<string, unknown>)[key]);
}

type After = <T>(ms: number, value: () => T) => Promise<T>;
type Emit = (event: string, payload: unknown) => void;

export function chapterCommands(
  after: After,
  emit: Emit,
): Record<string, (args: unknown) => Promise<unknown>> {
  const prepare = async (id: string, depth: Depth): Promise<ChapterWords> => {
    const current = chapterWords(id).chapter.prepared;
    if (current !== null && DEPTHS.indexOf(current) >= DEPTHS.indexOf(depth)) {
      return after(150, () => chapterWords(id));
    }
    const report = (done: number): void => {
      emit("chapter-progress", {
        chapterId: id,
        done,
        total: PIECES,
      } satisfies ChapterProgress);
    };
    await after(200, () => {
      checkCanPrepare(id);
      report(0);
    });
    for (let done = 1; done <= PIECES; done += 1) {
      await after(900, () => {
        report(done);
      });
    }
    // Words already there stay as they are; a deeper depth only adds, and
    // never a word the learner knows already.
    const kept = chapterWords(id).words;
    const added = wordsUpTo(id, depth).filter(
      (found) =>
        !isMockWordKnown(found.lemma) &&
        !kept.some((word) => word.id === found.id),
    );
    words.set(id, byCount([...kept, ...added]));
    setMockChapterPrepared(id, depth);
    return chapterWords(id);
  };

  return {
    get_chapter_words: (args) =>
      after(150, () => chapterWords(arg(args, "id"))),
    prepare_chapter: (args) =>
      prepare(arg(args, "id"), arg(args, "depth") as Depth),
    set_word_known: (args) =>
      after(80, () =>
        setKnown(
          arg(args, "wordId"),
          (args as Record<string, unknown>).known === true,
        ),
      ),
    set_word_sorted: (args) =>
      after(80, () =>
        setSorted(
          arg(args, "wordId"),
          (args as Record<string, unknown>).sorted === true,
        ),
      ),
    restart_sorting: (args) => after(80, () => restartSorting(arg(args, "id"))),
    label_words: () =>
      after(600, () => {
        const labelled = unlabelled ? Object.values(FOUND).flat().length : 0;
        unlabelled = false;
        return labelled;
      }),
    list_known_words: () => after(80, knownWords),
    forget_known_word: (args) =>
      after(80, () => {
        setMockWordKnown(arg(args, "key"), false);
        return knownWords();
      }),
  };
}
