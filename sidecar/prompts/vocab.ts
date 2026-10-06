import type {
  VocabExtractParams,
  VocabJudgeParams,
  VocabLabelParams,
} from "../../shared/protocol.ts";
import {
  DATA_NOT_INSTRUCTIONS,
  LEVEL_CEFR,
  VERB_FORM_RULE,
  languageName,
  nativeLanguageRule,
} from "./common.ts";

const DEPTH_RULES: Record<VocabExtractParams["depth"], string> = {
  most: "most: every word or expression a learner of this level probably does not know yet. Leave out only what such a learner surely knows.",
  relevant:
    "relevant: of the words a learner of this level probably does not know, only those that recur in the text or carry its meaning, the ones without which a sentence that matters cannot be followed. Skip incidental ones.",
  hardest:
    "hardest: only the rare, literary or specialised words and expressions, those even a learner one level above would probably not know. Skip everything else.",
};

/** What kind of word an item is: the same labels wherever they are asked for. */
const PART_OF_SPEECH_RULE = `partOfSpeech: what the item is in that sentence: "noun", "verb", "adjective" or "adverb" for a single word; "phrasalVerb" for a phrasal verb; "expression" for an idiom or a fixed expression; "other" for anything else.`;

/** Whether a verb takes an object: the same label wherever it is asked for. */
const TRANSITIVE_RULE = `transitive: true when the item is a verb or a phrasal verb that takes a direct object in that sentence, so that it can be turned into the passive ("adorn the hall" gives "the hall was adorned"). False for a verb used without an object ("she trotted off"), and for anything that is not a verb.`;

/** Picks the words of one piece of a chapter worth learning before reading it. */
export function vocabExtractSystemPrompt(params: VocabExtractParams): string {
  const native = languageName(params.nativeLang);
  return `You prepare an adult English learner to read a book without stopping at unknown words. The learner's level is ${params.level} (CEFR ${LEVEL_CEFR[params.level]}) and their language is ${native}. You are given one piece of a chapter. List the vocabulary of that piece the learner should learn first.

Depth, judged against the learner's level:
${DEPTH_RULES[params.depth]}

For each item:
- lemma: the base form in English, lowercase: "run" for "ran", "child" for "children", "give up" for "gave up". A phrasal verb, an idiom or a fixed expression is one item, never split into its words. No leading "to" or article.
- form: the word or expression exactly as it appears in the text.
- sentence: the sentence it appears in, copied exactly from the text.
- ${PART_OF_SPEECH_RULE}
- ${TRANSITIVE_RULE}
- ${VERB_FORM_RULE}
- translations: every natural ${native} translation of the item in the sense it has in that sentence, base form, lowercase, at least one. A learner's typed answer is checked against this list, so include the common synonyms and nothing that fits only another sense.
- properNoun: true for a name of a person, place, brand or title. Otherwise false.
- needsContext: true when the item has several unrelated meanings and the learner could not tell which one is meant without the sentence. Otherwise false.

List each lemma once, with its first sentence. A verb is listed once for each form the text has it in ("swore" and "sworn" are two items of the lemma "swear"), each with the first sentence that has that form. Do not list numbers. If nothing in the piece fits the depth, return an empty list.`;
}

/** Book text is material to read, whatever it says. */
export function vocabExtractUserPrompt(params: VocabExtractParams): string {
  return `${DATA_NOT_INSTRUCTIONS} It is a piece of a book the learner uploaded.

<text>
${params.text}
</text>`;
}

/**
 * Says what kind of word each word is, whether it takes an object and the
 * form a verb has, for words stored without one of the three, and puts the
 * translations a word comes with in the form of the word.
 */
export function vocabLabelSystemPrompt(): string {
  return `An adult English learner is learning the vocabulary of a book before reading it. You are given words and expressions of that book, each with the sentence it was taken from. Say what kind of word each one is in its sentence, whether it takes an object there, and the form a verb has there.

For each word:
- id: its id, unchanged.
- ${PART_OF_SPEECH_RULE}
- ${TRANSITIVE_RULE}
- ${VERB_FORM_RULE}
- inForm: when the word comes with translations, those translations, one for each and in the same order, each put in the form the word has: the learner sees them and has to type the word in that form, so "jurado" for "jurar" when the word is "sworn", "juró" for "swore", "jurando" for "swearing", "jura" for "swears". A participle is given on its own, masculine singular, without an auxiliary; a past or a present takes the person its sentence gives it. Written in the language the translations are in, never in English. Empty when the word comes without translations.

Answer with one label per word.`;
}

/** The words and their sentences are material to label, whatever they say. */
export function vocabLabelUserPrompt(params: VocabLabelParams): string {
  const words = params.words.map((word) =>
    [
      `<word id="${word.id}">`,
      `  <lemma>${word.lemma}</lemma>`,
      `  <sentence>${word.sentence}</sentence>`,
      ...(word.translations.length > 0
        ? [`  <translations>${word.translations.join(" | ")}</translations>`]
        : []),
      `</word>`,
    ].join("\n"),
  );
  return `${DATA_NOT_INSTRUCTIONS} The sentences are from a book the learner uploaded.

${words.join("\n")}`;
}

/** What the learner was asked, and what their answer has to be. */
function judgeTask(params: VocabJudgeParams, native: string): string {
  if (params.direction === "production" && params.blank !== null) {
    return `The learner was shown the ${native} translation of the word, and the sentence with the word taken out, and typed an English word into the blank. The blank is filled by "${params.blank}". Decide whether their answer fills it just as well: an English word or expression with the same meaning, in the form the sentence needs there (the same tense, person and number). Another form of the right word does not fill the blank and is not right.`;
  }
  return params.direction === "recognition"
    ? `The learner was shown the English word and typed a translation in ${native}. Decide whether their answer is a right ${native} translation of the word in the sense it has in the sentence.`
    : `The learner was shown the ${native} translations, and the sentence with the word taken out, and typed an English word. Decide whether their answer is right: another form of the word, or an English word or expression with the same meaning that fits the sentence in its place.`;
}

/** How much of the way an answer is written the judge lets pass. */
function formRule(params: VocabJudgeParams): string {
  return params.strictSpelling
    ? `- The learner asked for spelling to count: an answer with a missing or wrong accent, or with a letter wrong, missing, doubled or added, is not right. Still ignore case, a leading article or "to", and gender or number.`
    : `- Be lenient on form: ignore case, accents and other special characters (ñ typed as n), a leading article or "to", and gender or number. The letters themselves count: an answer with a letter wrong, missing, doubled or added is not right, however clear the word meant.`;
}

/** "I was right": judges one missed answer the learner stands by. */
export function vocabJudgeSystemPrompt(params: VocabJudgeParams): string {
  const native = languageName(params.nativeLang);
  return `An adult English learner whose language is ${native} is learning the vocabulary of a book before reading it. Their typed answer was checked by code against a list of accepted translations and marked wrong. The learner says it was right.

${judgeTask(params, native)}

- Be strict on meaning: the answer must fit the sense of the word in that sentence. A translation of another sense of the word, a vaguer or broader word, or a related word that says something else is not right.
${formRule(params)}
- The accepted list is not complete: a right answer that is missing from it is right.

Answer with:
- correct: true when the answer is right, false otherwise.
- reason: one short line saying why, for the learner to read.

${nativeLanguageRule(params.nativeLang)}`;
}

/** The sentence and the answer are material to judge, whatever they say. */
export function vocabJudgeUserPrompt(params: VocabJudgeParams): string {
  return `${DATA_NOT_INSTRUCTIONS} The sentence is from a book the learner uploaded; the answer is what the learner typed.

<word>${params.lemma}</word>
<sentence>${params.sentence}</sentence>
<accepted>${params.translations.join(" | ")}</accepted>
<answer>${params.answer}</answer>`;
}
