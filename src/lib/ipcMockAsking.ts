/**
 * How the mock shows a word and reads an answer to it: the words asked with
 * their sentence, what may lead an answer, and the hint. Shared by practice,
 * the refresh, the recall and the penalty review (`ipcMockPractice.ts`).
 */
import type {
  BookWord,
  Direction,
  PracticeItem,
  SentencePart,
  WordHint,
} from "@shared/domain";

/** What may lead an answer in the learner's language, and in English. */
export const ARTICLES = new Set(["el", "la", "los", "las", "un", "una"]);
export const LEADING = new Set(["to", "a", "an", "the"]);

/** The sentences of the words that are asked with their context. */
const CONTEXT: Record<string, SentencePart[]> = {
  tumble: [
    { text: "Down she ", marked: false },
    { text: "tumbled", marked: true },
    { text: ", after the Rabbit.", marked: false },
  ],
  bank: [
    { text: "Alice sat by her sister on the ", marked: false },
    { text: "bank", marked: true },
    { text: ".", marked: false },
  ],
};

/** An answer as it is compared: no case, accents, punctuation or `leading`. */
export function normal(text: string, leading: ReadonlySet<string>): string {
  const words = text
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const [first] = words;
  const rest =
    words.length > 1 && first !== undefined && leading.has(first)
      ? words.slice(1)
      : words;
  return rest.join(" ");
}

/** The forms of the word in its sentence: the pieces marked there. */
function bookForms(word: BookWord): string[] {
  return (CONTEXT[word.lemma] ?? [])
    .filter((part) => part.marked)
    .map((part) => part.text);
}

/**
 * The English the word is asked for: the forms its sentence is blanked of,
 * or its base form when it is asked without one.
 */
export function english(word: BookWord): string[] {
  const forms = bookForms(word);
  return forms.length > 0 ? forms : [word.lemma];
}

/** The mock asks no word with a sentence of a bank: nothing to add. */
export const PLAIN = {
  again: false,
  another: null,
  otherKind: null,
  helped: false,
  exact: null,
  sentence: null,
  ladder: null,
  understood: null,
};

/** A word as an exercise shows it: `commands::practice::small`. */
export function small(texts: readonly string[]): string[] {
  return texts.map((text) => text.toLowerCase());
}

/**
 * A hint to the word asked this way: `books::hint::mask` in small. The mock
 * keeps no sentence back: a word shows its own from the start or has none,
 * so every hint is to the answer.
 */
export function hintOf(
  word: BookWord,
  direction: Direction,
  letters: number,
): WordHint {
  const whole =
    (direction === "recognition" ? word.translations[0] : english(word)[0]) ??
    word.lemma;
  const chars = Array.from(whole.toLowerCase());
  const isLetter = (char: string): boolean => /[\p{L}\p{N}]/u.test(char);
  const most = Math.max(chars.filter(isLetter).length - 1, 0);
  const shown = Math.min(letters, most);
  const mask = chars
    .map((char, at) => {
      const before = chars.slice(0, at).filter(isLetter).length;
      return isLetter(char) && before >= shown ? "_" : char;
    })
    .join("");
  return { mask, context: null, more: letters < most };
}

/** The irregular verbs of the mock's books (`books::irregular` decides). */
const IRREGULAR = new Set(["give up", "run out", "fall", "find"]);

/** Whether a verb is irregular; null for any other word. */
function regularity(word: BookWord): boolean | null {
  const verb =
    word.partOfSpeech === "verb" || word.partOfSpeech === "phrasalVerb";
  return verb ? IRREGULAR.has(word.lemma.toLowerCase()) : null;
}

/** The word as it is asked: nothing of `production` holds the English. */
export function itemOf(word: BookWord, direction: Direction): PracticeItem {
  const context = CONTEXT[word.lemma] ?? null;
  const irregular = regularity(word);
  if (direction === "recognition") {
    return {
      wordId: word.id,
      direction,
      prompt: word.lemma.toLowerCase(),
      partOfSpeech: word.partOfSpeech,
      context,
      nativeContext: null,
      sentenceId: null,
      verbForm: null,
      irregular,
    };
  }
  return {
    wordId: word.id,
    direction,
    prompt: small(word.translations).join(", "),
    partOfSpeech: word.partOfSpeech,
    context:
      context?.map((part) => (part.marked ? { ...part, text: "" } : part)) ??
      null,
    nativeContext: null,
    sentenceId: null,
    verbForm: null,
    irregular,
  };
}
