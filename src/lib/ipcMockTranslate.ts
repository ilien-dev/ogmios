/**
 * The mock's chapter translation: `src-tauri/src/commands/translate.rs` in
 * small. Every chapter has the same four paragraphs, cut into sentences
 * already, and is translated in attempts: one is paused, gone on with or
 * finished, and a new one starts over. A sentence is written in order, a
 * paragraph that is whole is reviewed, and it goes back into English once
 * an attempt has it whole the other way. There is no model: the versions and the reviews are fixed,
 * written for a Spanish speaker, the learner the mock is seeded with.
 */
import type {
  AttemptSummary,
  ParagraphReview,
  ReviewMark,
  ReviewPart,
  SentencePart,
  Severity,
  Translation,
  TranslationAttempt,
  TranslationAttempts,
  TranslationDirection,
  TranslationParagraph,
} from "@shared/domain";
import { findMockChapter } from "./ipcMockBooks";
import { mockLearnedWords } from "./ipcMockChapters";
import { PracticeError } from "./ipcMockPractice";

interface Paragraph {
  english: string[];
  native: string[];
}

const PARAGRAPHS: readonly Paragraph[] = [
  {
    english: [
      "The boy woke before the sirens did.",
      "He lay still and counted the cracks in the ceiling;",
      "there were eleven, the same as yesterday.",
    ],
    native: [
      "El chico despertó antes que las sirenas.",
      "Se quedó quieto y contó las grietas del techo;",
      "había once, las mismas que ayer.",
    ],
  },
  {
    english: [
      "He had not slept in three days.",
      "The officer at the gate looked at him the way people look at a stray dog;",
      "“You know what happens if you fall asleep here?” the man asked.",
    ],
    native: [
      "Llevaba tres días sin dormir.",
      "El oficial de la puerta lo miró como se mira a un perro callejero;",
      "—¿Sabes lo que pasa si te quedas dormido aquí? —preguntó el hombre.",
    ],
  },
  {
    english: [
      "The boy knew.",
      "Everyone knew what the trial did to those who entered it unprepared.",
    ],
    native: [
      "El chico lo sabía.",
      "Todos sabían lo que la prueba les hacía a quienes entraban en ella sin estar preparados.",
    ],
  },
  {
    english: [
      "They gave him a cot in a room with no windows.",
      "When he opened his eyes again, the room was gone.",
    ],
    native: [
      "Le dieron un catre en una habitación sin ventanas.",
      "Cuando volvió a abrir los ojos, la habitación ya no estaba.",
    ],
  },
];

/** The English every mock chapter is made of: its sentences by paragraph. */
export function mockEnglish(): ReadonlyArray<readonly string[]> {
  return PARAGRAPHS.map((paragraph) => paragraph.english);
}

/** One thing a fixed review says about a sentence. */
interface Note {
  sentence: number;
  severity: Severity;
  better: string;
  why: string;
  /** The English word it is about, with its translation. */
  word: [english: string, translation: string] | null;
}

/**
 * What each review says, by direction and paragraph; the last has no note.
 * A note marks the first word the learner wrote in its sentence, whatever
 * that is: the mock cannot read.
 */
const NOTES: Record<TranslationDirection, readonly Note[][]> = {
  toNative: [
    [
      {
        sentence: 0,
        severity: "error",
        better: "El chico",
        why: "«did» repite el verbo «woke»: las sirenas también despiertan.",
        word: ["siren", "sirena"],
      },
      {
        sentence: 2,
        severity: "slip",
        better: "había",
        why: "«there were» dice que existen: «había once».",
        word: null,
      },
    ],
    [
      {
        sentence: 1,
        severity: "error",
        better: "callejero",
        why: "«stray» es un animal sin dueño, no «perdido» ni «extraño».",
        word: ["stray", "callejero"],
      },
    ],
    [
      {
        sentence: 1,
        severity: "error",
        better: "la prueba",
        why: "En este capítulo «the trial» es una prueba que se supera, no un juicio.",
        word: ["trial", "prueba"],
      },
    ],
    [],
  ],
  toEnglish: [
    [
      {
        sentence: 2,
        severity: "error",
        better: "there were",
        why: "Para decir cuántos hay, el inglés usa «there» + «be».",
        word: null,
      },
      {
        sentence: 1,
        severity: "slip",
        better: "in the ceiling",
        why: "Las grietas están «in» el techo, no «of».",
        word: null,
      },
    ],
    [
      {
        sentence: 0,
        severity: "error",
        better: "had not slept",
        why: "«Llevaba tres días sin dormir» mira atrás desde el pasado.",
        word: null,
      },
    ],
    [
      {
        sentence: 1,
        severity: "error",
        better: "unprepared",
        why: "«Sin estar preparados» cabe en una palabra: «unprepared».",
        word: ["unprepared", "sin preparar"],
      },
    ],
    [],
  ],
};

const GOOD: ReadonlyArray<string | null> = [
  "Mantuviste el punto y coma y el ritmo corto del autor.",
  null,
  "La primera frase conserva la sequedad del original.",
  "Frases cortas, como las del autor.",
];

const SUMMARY: AttemptSummary = {
  points: [
    "Lee la frase entera antes de traducir su primera palabra.",
    "Fíjate en el sentido que tiene cada palabra en este capítulo.",
  ],
  habits: [
    {
      habit: "La primera palabra de la frase",
      advice: "Casi todos tus errores están ahí: vuelve a ella al terminar.",
      examples: ["El niño", "perdido"],
    },
  ],
};

const FULL_SCORE = 100;

function words(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

/** One attempt at a chapter, with what the learner wrote in it. */
interface Attempt {
  id: string;
  chapterId: string;
  direction: TranslationDirection;
  startedAt: string;
  finished: boolean;
  /** By paragraph, its sentences in order. */
  written: string[][];
  reviewed: Set<number>;
  summed: boolean;
}

/** Every attempt, in the order they were started. */
let attempts: Attempt[] = [];
/** By chapter, the paragraphs that have their version back into English. */
let versions: Map<string, Set<number>> = new Map();
/** By chapter, the words added to its practice from a review. */
let practised: Map<string, Set<string>> = new Map();
let fail = false;

/** Forgets everything written. */
export function resetMockTranslate(): void {
  attempts = [];
  versions = new Map();
  practised = new Map();
  fail = false;
}

/** Makes versions and reviews fail as when Claude cannot be reached, or work. */
export function setMockTranslateFails(failing: boolean): void {
  fail = failing;
}

function found(attemptId: string): Attempt {
  const attempt = attempts.find((each) => each.id === attemptId);
  if (attempt === undefined) {
    throw new PracticeError("notFound", "attempt not found");
  }
  return attempt;
}

function isWhole(paragraph: TranslationParagraph): boolean {
  return (
    paragraph.source !== null &&
    paragraph.written.length >= paragraph.source.length
  );
}

/** Whether an attempt has the paragraph whole in the learner's language. */
function wholeThere(chapterId: string, index: number): boolean {
  const sentences = PARAGRAPHS[index]?.english.length ?? 0;
  return attempts.some(
    (each) =>
      each.chapterId === chapterId &&
      each.direction === "toNative" &&
      (each.written[index]?.length ?? 0) >= sentences,
  );
}

/**
 * The review of a paragraph as `books::translate::shown` builds it: each
 * note on the first word of its sentence, and the score by words.
 */
function reviewOf(attempt: Attempt, index: number): ParagraphReview {
  const written = attempt.written[index] ?? [];
  const notes = NOTES[attempt.direction][index] ?? [];
  const added = practised.get(attempt.chapterId);
  const marks: ReviewMark[] = [];
  const sentences = written.map((sentence, at): ReviewPart[] => {
    const note = notes.find((each) => each.sentence === at);
    const [fragment = ""] = sentence.split(" ");
    if (note === undefined || fragment === "") {
      return [{ text: sentence, mark: null }];
    }
    marks.push({
      fragment,
      severity: note.severity,
      better: note.better,
      why: note.why,
      word:
        note.word === null
          ? null
          : {
              english: note.word[0],
              translations: [note.word[1]],
              inPractice: added?.has(note.word[0]) === true,
            },
    });
    return [
      { text: fragment, mark: marks.length - 1 },
      { text: sentence.slice(fragment.length), mark: null },
    ];
  });
  const total = Math.max(1, words(written.join(" ")));
  const lost = marks.reduce(
    (sum, mark) => sum + (mark.severity === "error" ? 2 : 1),
    0,
  );
  const off = Math.min(
    FULL_SCORE,
    Math.floor((FULL_SCORE * lost) / (2 * total)),
  );
  return {
    score: Math.max(1, FULL_SCORE - off),
    good: GOOD[index] ?? null,
    sentences,
    marks,
  };
}

/** A sentence in pieces, the shelf's learned words marked. */
function withLearned(sentence: string): SentencePart[] {
  const learned = new Set(
    mockLearnedWords()
      .filter((word) => !word.known)
      .map((word) => word.lemma.toLowerCase()),
  );
  // Words and what lies between them, by turns; what is plain stays whole.
  const parts: SentencePart[] = [];
  for (const text of sentence.split(/([A-Za-z']+)/u)) {
    const marked = learned.has(text.toLowerCase());
    const last = parts.at(-1);
    if (marked || last === undefined || last.marked) {
      parts.push({ text, marked });
    } else {
      last.text += text;
    }
  }
  return parts.filter((part) => part.text !== "");
}

function translation(attempt: Attempt): Translation {
  const back = attempt.direction === "toEnglish";
  const prepared = versions.get(attempt.chapterId);
  const paragraphs = PARAGRAPHS.flatMap(
    (paragraph, index): TranslationParagraph[] => {
      if (back && !wholeThere(attempt.chapterId, index)) {
        return [];
      }
      const version =
        prepared?.has(index) === true ? [...paragraph.native] : null;
      return [
        {
          index,
          source: back ? version : [...paragraph.english],
          written: [...(attempt.written[index] ?? [])],
          english: [...paragraph.english],
          learned: paragraph.english.map(withLearned),
          review: attempt.reviewed.has(index) ? reviewOf(attempt, index) : null,
        },
      ];
    },
  );
  const scored = paragraphs.flatMap((each) =>
    each.review === null
      ? []
      : [[each.review.score, Math.max(1, words(each.written.join(" ")))]],
  );
  const weight = scored.reduce((sum, [, count = 0]) => sum + count, 0);
  const points = scored.reduce(
    (sum, [score = 0, count = 0]) => sum + score * count,
    0,
  );
  return {
    attemptId: attempt.id,
    chapterId: attempt.chapterId,
    direction: attempt.direction,
    finished: attempt.finished,
    score: weight === 0 ? null : Math.max(1, Math.floor(points / weight)),
    summary: attempt.summed ? summaryOf(paragraphs) : null,
    paragraphs,
    current: paragraphs.find((each) => !isWhole(each))?.index ?? null,
    total: PARAGRAPHS.length,
  };
}

/** The fixed summary, or an empty one for an attempt with nothing marked. */
function summaryOf(
  paragraphs: readonly TranslationParagraph[],
): AttemptSummary {
  const marked = paragraphs.some(
    (each) => each.review !== null && each.review.marks.length > 0,
  );
  return marked ? SUMMARY : { points: [], habits: [] };
}

function list(chapterId: string): TranslationAttempts {
  if (findMockChapter(chapterId) === undefined) {
    throw new PracticeError("notFound", "chapter not found");
  }
  const listed = attempts
    .filter((each) => each.chapterId === chapterId)
    .map((each): TranslationAttempt => {
      const state = translation(each);
      return {
        id: each.id,
        direction: each.direction,
        startedAt: each.startedAt,
        finished: each.finished,
        done: state.paragraphs.filter(isWhole).length,
        total: state.paragraphs.length,
      };
    });
  return {
    attempts: [...listed].reverse(),
    paragraphs: PARAGRAPHS.length,
    back: PARAGRAPHS.filter((_, index) => wholeThere(chapterId, index)).length,
  };
}

function start(
  chapterId: string,
  direction: TranslationDirection,
): Translation {
  if (findMockChapter(chapterId) === undefined) {
    throw new PracticeError("notFound", "chapter not found");
  }
  const attempt: Attempt = {
    id: `attempt-${String(attempts.length + 1)}-${chapterId}`,
    chapterId,
    direction,
    startedAt: new Date().toISOString(),
    finished: false,
    written: PARAGRAPHS.map(() => []),
    reviewed: new Set(),
    summed: false,
  };
  const state = translation(attempt);
  if (state.paragraphs.length === 0) {
    throw new PracticeError(
      "invalid",
      "no paragraph is translated into your language yet",
    );
  }
  attempts.push(attempt);
  return state;
}

/** Paused or finished; one with nothing written is not kept. */
function close(attemptId: string, finished: boolean): null {
  const attempt = found(attemptId);
  if (attempt.written.every((sentences) => sentences.length === 0)) {
    attempts = attempts.filter((each) => each !== attempt);
  } else if (finished) {
    attempt.finished = true;
  }
  return null;
}

function remove(attemptId: string): null {
  const attempt = found(attemptId);
  attempts = attempts.filter((each) => each !== attempt);
  return null;
}

/** What a command about an attempt receives. */
interface Sent {
  chapterId: string;
  direction: TranslationDirection;
  attemptId: string;
  finished: boolean;
  paragraph: number;
  sentence: number;
  mark: number;
  text: string;
}

function write(sent: Sent): Translation {
  const text = sent.text.split(/\s+/u).filter(Boolean).join(" ");
  if (text === "") {
    throw new PracticeError("invalid", "a sentence cannot be empty");
  }
  const attempt = found(sent.attemptId);
  if (attempt.finished) {
    throw new PracticeError("invalid", "this attempt is finished");
  }
  const state = translation(attempt);
  const being = state.paragraphs.find((each) => each.index === sent.paragraph);
  if (state.current !== sent.paragraph || being === undefined) {
    throw new PracticeError(
      "invalid",
      "this paragraph is not the one being translated",
    );
  }
  if (being.source === null) {
    throw new PracticeError("invalid", "this paragraph is not prepared yet");
  }
  if (
    sent.sentence > being.written.length ||
    sent.sentence >= being.source.length
  ) {
    throw new PracticeError("invalid", "this sentence is not the next one");
  }
  const kept = attempt.written[sent.paragraph];
  if (kept !== undefined) {
    kept[sent.sentence] = text;
  }
  return translation(attempt);
}

function prepare(attemptId: string, paragraph: number): Translation {
  const attempt = found(attemptId);
  if (!wholeThere(attempt.chapterId, paragraph)) {
    throw new PracticeError("invalid", "this paragraph is not open yet");
  }
  const prepared = versions.get(attempt.chapterId) ?? new Set<number>();
  if (!prepared.has(paragraph)) {
    if (fail) {
      throw new PracticeError("provider", "Claude could not be reached");
    }
    versions.set(attempt.chapterId, prepared.add(paragraph));
  }
  return translation(attempt);
}

function review(attemptId: string, paragraph: number): Translation {
  const attempt = found(attemptId);
  const state = translation(attempt);
  const being = state.paragraphs.find((each) => each.index === paragraph);
  if (being === undefined) {
    throw new PracticeError("invalid", "this paragraph is not open yet");
  }
  if (being.review !== null) {
    return state;
  }
  if (!isWhole(being)) {
    throw new PracticeError("invalid", "this paragraph is not whole yet");
  }
  if (fail) {
    throw new PracticeError("provider", "Claude could not be reached");
  }
  attempt.reviewed.add(paragraph);
  return translation(attempt);
}

function summarize(attemptId: string): Translation {
  const attempt = found(attemptId);
  if (!attempt.finished) {
    throw new PracticeError("invalid", "this attempt is not finished");
  }
  if (!attempt.summed && fail) {
    throw new PracticeError("provider", "Claude could not be reached");
  }
  attempt.summed = true;
  return translation(attempt);
}

function practise(
  attemptId: string,
  paragraph: number,
  mark: number,
): Translation {
  const attempt = found(attemptId);
  const word = attempt.reviewed.has(paragraph)
    ? reviewOf(attempt, paragraph).marks[mark]?.word
    : undefined;
  if (word === undefined || word === null) {
    throw new PracticeError("invalid", "this mark has no word to practise");
  }
  const added = practised.get(attempt.chapterId) ?? new Set<string>();
  practised.set(attempt.chapterId, added.add(word.english));
  return translation(attempt);
}

type After = <T>(ms: number, value: () => T) => Promise<T>;

export function translateCommands(
  after: After,
): Record<string, (args: unknown) => Promise<unknown>> {
  return {
    list_attempts: (args) => after(150, () => list((args as Sent).chapterId)),
    start_attempt: (args) =>
      after(150, () => {
        const sent = args as Sent;
        return start(sent.chapterId, sent.direction);
      }),
    get_attempt: (args) =>
      after(150, () => translation(found((args as Sent).attemptId))),
    close_attempt: (args) =>
      after(60, () => {
        const sent = args as Sent;
        return close(sent.attemptId, sent.finished);
      }),
    delete_attempt: (args) => after(60, () => remove((args as Sent).attemptId)),
    write_sentence: (args) => after(60, () => write(args as Sent)),
    prepare_paragraph: (args) =>
      after(700, () => {
        const sent = args as Sent;
        return prepare(sent.attemptId, sent.paragraph);
      }),
    review_paragraph: (args) =>
      after(900, () => {
        const sent = args as Sent;
        return review(sent.attemptId, sent.paragraph);
      }),
    summarize_attempt: (args) =>
      after(900, () => summarize((args as Sent).attemptId)),
    practise_word: (args) =>
      after(150, () => {
        const sent = args as Sent;
        return practise(sent.attemptId, sent.paragraph, sent.mark);
      }),
  };
}
