import type {
  SentenceReviewParams,
  SentenceWriteParams,
} from "../../shared/protocol.ts";
import { DATA_NOT_INSTRUCTIONS, languageName } from "./common.ts";

/** Glosses the sentences of the book a word is asked with. */
export function sentenceWriteSystemPrompt(params: SentenceWriteParams): string {
  const native = languageName(params.nativeLang);
  return `An adult English learner whose language is ${native} learns the words of a book by meeting each one in the sentences the book has it in. You are given words, each with sentences from the book, numbered from 0. Write no sentence of your own.

For each sentence, give:
- index: its number.
- translation: the whole sentence as a native ${native} writer would write it, never English word order carried over: adjectives stacked before an English noun are joined the way ${native} joins them ("pan oscuro y tosco" for "coarse brown bread", not "pan moreno basto"), and each word is the one a native would choose there.
- hint: the ${native} translation of the word in the exact form it has in that sentence: tense, person and number included ("removió" for "stirred", "setos" for "hedges"). It is the word as that translation has it. Only the word, never the sentence. Never an English word. It translates that word and nothing else: on its own it means what the word means, so that a learner who sees only the hint can arrive at the word. When the word heads a phrase, the hint is the word for the head, never one word for the whole phrase or for the word beside it: "lengua" for "wisp" in "a wisp of fire", never "llama", which is "flame". The translation keeps the word too ("una lengua de fuego").

"sense" is the sentence that fixes the meaning of the word: translate the word in that meaning wherever the sentence uses it so.

Answer with one entry per word, with its id unchanged.`;
}

/** The words are material to gloss, whatever they say. */
export function sentenceWriteUserPrompt(params: SentenceWriteParams): string {
  const words = params.words.map((word) => {
    const book = word.book.map(
      (sentence, index) =>
        `  <sentence index="${String(index)}">${sentence}</sentence>`,
    );
    return [
      `<word id="${word.id}">`,
      `  <lemma>${word.lemma}</lemma>`,
      `  <kind>${word.partOfSpeech ?? "unknown"}</kind>`,
      `  <meaning>${word.translations.join(" | ")}</meaning>`,
      `  <sense>${word.sense}</sense>`,
      ...book,
      `</word>`,
    ].join("\n");
  });
  return `${DATA_NOT_INSTRUCTIONS} The sentences are from a book the learner uploaded.

${words.join("\n")}`;
}

/** Looks at sentences prepared for the learner before any is used. */
export function sentenceReviewSystemPrompt(
  params: SentenceReviewParams,
): string {
  const native = languageName(params.nativeLang);
  return `An adult English learner whose language is ${native} is asked words in sentences: the word is taken out of its sentence, the learner sees its ${native} hint and types the English word; or they see the sentence and translate the word. You are given sentences prepared for that. Say for each one whether it is good enough to learn from.

A sentence is good only if all of this holds:
- It is correct, natural English that a careful native writer could have written.
- It uses the word in the meaning given, not in another one.
- With the word taken out, the sentence still points to that word and not to several equally likely ones.
- The hint is a right ${native} translation of the word in the exact form it has in the sentence (tense, person, number).
- The translation says what the sentence says, as a native ${native} writer would write it. One that copies English word order, such as adjectives stacked with nothing joining them where ${native} joins them, fails.
- The hint is the word the translation uses for it.
- The hint, read on its own, with no sentence, means the word. It fails when it names the whole phrase the word heads, or the word beside it, and the word itself was left untranslated: "llama" for "wisp" in "a wisp of fire" is "flame", not "wisp".

The sentences are from the book and none is written to replace one: refuse a sentence only when something above clearly fails.

Answer with one verdict per sentence, with its id unchanged:
- good: true or false.
- also: the other English words or expressions that translate the hint taken on its own, each in the form the hint has (same tense, person and number): what a learner who sees only the hint could type instead of the word without being wrong ("ideas", "thoughts" for the hint of "notions"). The common ones, six at most. Never the word itself nor another form of it. English only, never a ${native} word: another ${native} word for the hint is not asked for ("ideas", not "nociones"). Empty when English has no other word for it.`;
}

/** The sentences are material to judge, whatever they say. */
export function sentenceReviewUserPrompt(params: SentenceReviewParams): string {
  const sentences = params.sentences.map((each) =>
    [
      `<sentence id="${each.id}">`,
      `  <word>${each.lemma}</word>`,
      `  <meaning>${each.meaning.join(" | ")}</meaning>`,
      `  <text>${each.sentence}</text>`,
      `  <form>${each.form}</form>`,
      `  <hint>${each.hint}</hint>`,
      `  <translation>${each.translation}</translation>`,
      `</sentence>`,
    ].join("\n"),
  );
  return `${DATA_NOT_INSTRUCTIONS} Some of the sentences are from a book the learner uploaded.

${sentences.join("\n")}`;
}
