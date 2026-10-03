import type {
  VocabExtractParams,
  VocabJudgeParams,
} from "../../shared/protocol.ts";
import {
  DATA_NOT_INSTRUCTIONS,
  LEVEL_CEFR,
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
- translations: every natural ${native} translation of the item in the sense it has in that sentence, base form, lowercase, at least one. A learner's typed answer is checked against this list, so include the common synonyms and nothing that fits only another sense.
- properNoun: true for a name of a person, place, brand or title. Otherwise false.
- needsContext: true when the item has several unrelated meanings and the learner could not tell which one is meant without the sentence. Otherwise false.

List each lemma once, with its first sentence. Do not list numbers. If nothing in the piece fits the depth, return an empty list.`;
}

/** Book text is material to read, whatever it says. */
export function vocabExtractUserPrompt(params: VocabExtractParams): string {
  return `${DATA_NOT_INSTRUCTIONS} It is a piece of a book the learner uploaded.

<text>
${params.text}
</text>`;
}

/** What the learner was asked, and what their answer has to be. */
function judgeTask(params: VocabJudgeParams, native: string): string {
  return params.direction === "recognition"
    ? `The learner was shown the English word and typed a translation in ${native}. Decide whether their answer is a right ${native} translation of the word in the sense it has in the sentence.`
    : `The learner was shown the ${native} translations, and the sentence with the word taken out, and typed an English word. Decide whether their answer is right: another form of the word, or an English word or expression with the same meaning that fits the sentence in its place.`;
}

/** "I was right": judges one missed answer the learner stands by. */
export function vocabJudgeSystemPrompt(params: VocabJudgeParams): string {
  const native = languageName(params.nativeLang);
  return `An adult English learner whose language is ${native} is learning the vocabulary of a book before reading it. Their typed answer was checked by code against a list of accepted translations and marked wrong. The learner says it was right.

${judgeTask(params, native)}

- Be strict on meaning: the answer must fit the sense of the word in that sentence. A translation of another sense of the word, a vaguer or broader word, or a related word that says something else is not right.
- Be lenient on form: ignore case, accents, a spelling slip that leaves no doubt about the word meant, a leading article or "to", and gender or number.
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
