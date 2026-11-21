import type {
  SentenceReviewParams,
  SentenceWriteParams,
} from "../../shared/protocol.ts";
import {
  DATA_NOT_INSTRUCTIONS,
  VERB_FORM_RULE,
  languageName,
  nativeVarietyParagraph,
} from "./common.ts";

/**
 * Glosses the sentences of the chapter a word is asked with, and writes the
 * ones asked for in the sense the chapter gives it.
 */
export function sentenceWriteSystemPrompt(params: SentenceWriteParams): string {
  const native = languageName(params.nativeLang);
  return `An adult English learner whose language is ${native} learns the words of a book by meeting each one in sentences. You are given words, each with sentences from its chapter, numbered from 0, and how many new sentences to write for it (<write>).

For each sentence of the chapter, give:
- index: its number.
- translation: the whole sentence as a native ${native} writer would write it. The learner reads the book after this, so it must say what the sentence says the way ${native} says it, never English carried over. Not its word order, never English word order: adjectives stacked before an English noun are joined the way ${native} joins them ("pan oscuro y tosco" for "coarse brown bread", not "pan moreno basto"). Not its constructions either: where ${native} says it another way, use that way ("Para cuando llegaron" for "By the time they had arrived", "demasiado ancha para salvarse" for "too wide to be bridged"). Each word is the one a native would choose there.
- hint: the words of your translation that stand for the word, copied from it exactly as they are written there: "removió" for "stirred" in "Removió la sopa", "setos" for "hedges". It is the word as that translation has it, in the form natural ${native} gives it there, even where that is not the form of the English word: "salvarse" for "bridged" in "demasiado ancha para salvarse", never "salvada", which that translation does not have. Only those words, as few as hold the word, never the sentence. Never an English word. It translates that word and nothing else: on its own it means what the word means, so that a learner who sees only the hint can arrive at the word. When the word heads a phrase, the hint is the word for the head, never one word for the whole phrase or for the word beside it: "lengua" for "wisp" in "a wisp of fire", never "llama", which is "flame". The translation keeps the word too ("una lengua de fuego"). The hint stands for the word alone, never the words for the English words around it: an auxiliary, a subject or a pronoun beside the word stays out of the hint, and so does the tense it says, even where the translation needs them: "empeñado en" for "made a point of" in "I'd made a point of smoking" (translated "me había empeñado en fumar"), never "me había empeñado en", which is "had made a point of"; "corriendo" for "running" in "she was running". A tense the translation writes in one word stays as it is ("se empeñó en"). A negation outside the word stays out as well: "tendría ninguna oportunidad" for "stand a chance" in "wouldn't stand a chance" (translated "no tendría ninguna oportunidad"), never "no tendría ninguna oportunidad", which is "wouldn't stand a chance".

"sense" is the sentence that fixes the meaning of the word: translate the word in that meaning wherever the sentence uses it so.

Then write as many new sentences as <write> says, none when it is 0, under "written". Each one uses the word exactly once, in the meaning "sense" gives it and never in another, so that the sentence alone makes that meaning clear. Natural, everyday English a careful native writer would write, one sentence of at most 25 words, each about something different, none copied from the chapter, none that is or reads like one of <avoid> (the sentences the learner has already met for it: a new situation, other words around it), and none that negates the word. Vary the form where the word has several (tenses, plural). For each, give:
- sentence: the sentence.
- form: the word as the sentence writes it, copied from it exactly.
- translation and hint: as for the sentences of the chapter.

Answer with one entry per word, with its id unchanged.${nativeVarietyParagraph(params.nativeLang)}`;
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
      `  <write>${String(word.write)}</write>`,
      ...book,
      ...word.avoid.map((sentence) => `  <avoid>${sentence}</avoid>`),
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
- The hint is a right ${native} translation of the word as the sentence uses it. Its form is the one the translation has, which need not be the form of the English word: an infinitive for an English passive is right where that is how ${native} says it.
- The translation says what the sentence says, as a native ${native} writer would write it. One that copies English word order, such as adjectives stacked with nothing joining them where ${native} joins them, or an English construction ${native} says another way, fails.
- The hint is the word the translation uses for it, copied as it is written there.
- The hint, read on its own, with no sentence, means the word. It fails when it names the whole phrase the word heads, or the word beside it, and the word itself was left untranslated: "llama" for "wisp" in "a wisp of fire" is "flame", not "wisp".

Some sentences are from the book (from="book") and others were written for the learner (from="written"). Refuse one from the book only when something above clearly fails. Refuse a written one also when it reads as unnatural, or when it could be read in another meaning of the word.

Answer with one verdict per sentence, with its id unchanged:
- good: true or false.
- also: the other English words or expressions that translate the hint taken on its own, each in the form the word has in the sentence (same tense, person and number): what a learner who sees only the hint could type instead of the word without being wrong ("ideas", "thoughts" for the hint of "notions"). The common ones, six at most. Never the word itself nor another form of it. English only, never a ${native} word: another ${native} word for the hint is not asked for ("ideas", not "nociones"). Empty when English has no other word for it.
- hints: the other ${native} translations of the word as this sentence has it, each in the exact form the hint has (same tense, person and number): the other meanings given, put in that form, when they say there what the hint says ("se retiró", "se alejó" beside the hint "retrocedió", for the meanings "retroceder | retirarse | alejarse"). What could stand in the translation where the hint stands, and what a learner asked to translate the word could type instead of the hint and be right. Never the hint itself, never a base form the translation does not have, never an English word. Each translates only the words of <form>, as the hint does: no auxiliary or pronoun for English words outside it ("asegurado de" beside the hint "empeñado en" for the form "made a point of" in "I'd made a point of", never "me había asegurado de"). Nor anything a negation outside <form> gives them: no "no", and the words that negation calls for said as they are without it ("tendría posibilidades", "tendría una oportunidad" for the form "stand a chance" in "wouldn't stand a chance", never "tendría ninguna posibilidad"). Empty when there is none.
- cue: the one to three words of the sentence, besides the word itself, that fix which meaning the word has there and rule out its other meanings, each copied as the sentence writes it: "hair" for "fair" in "She tied back her fair hair" (blond, not just), "trial" for "fair" in "a fair trial". The fewest that do it, nearest the word first. Empty when no word of the sentence does.
- ${VERB_FORM_RULE}${nativeVarietyParagraph(params.nativeLang)}`;
}

/** The sentences are material to judge, whatever they say. */
export function sentenceReviewUserPrompt(params: SentenceReviewParams): string {
  const sentences = params.sentences.map((each) =>
    [
      `<sentence id="${each.id}" from="${each.fromBook ? "book" : "written"}">`,
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
