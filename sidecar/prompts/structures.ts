import type { PartOfSpeech } from "../../shared/domain.ts";
import type {
  StructureDetectParams,
  StructureGradeParams,
} from "../../shared/protocol.ts";
import {
  DATA_NOT_INSTRUCTIONS,
  LEVEL_CEFR,
  REAL_ENGLISH_RULE,
  languageName,
  nativeLanguageRule,
  variantName,
} from "./common.ts";

/** What a kind of word is called in a prompt; none for one of no kind. */
const KIND: Record<PartOfSpeech, string | null> = {
  noun: "a noun",
  verb: "a verb",
  phrasalVerb: "a phrasal verb",
  adjective: "an adjective",
  adverb: "an adverb",
  expression: "a fixed expression",
  other: null,
};

/** Labels one sentence written with a structure; Rust decides the verdict. */
export function structureGradeSystemPrompt(
  params: StructureGradeParams,
): string {
  const native = languageName(params.nativeLang);
  const { structure, word } = params;
  const kind = params.partOfSpeech === null ? null : KIND[params.partOfSpeech];
  const asked =
    word === null
      ? "writing one sentence with it"
      : "writing one sentence with it that uses a given word from a book they read";
  const met =
    kind === null
      ? ""
      : ` The learner met it as ${kind}; used as another kind of word it still counts.`;
  const usesWord =
    word === null
      ? "usesWord: always true, no word was given."
      : `usesWord: true when the sentence uses the given word, in any of its forms.${met}`;
  const betterWord =
    word === null
      ? ""
      : `\n  - It uses the given word${kind === null ? "" : `, as ${kind}`}, in a place where a speaker would really use it. The word may sit in another clause of the sentence when the structure leaves no room for it.`;
  return `An adult English learner whose level is ${params.level} (CEFR ${LEVEL_CEFR[params.level]}), whose language is ${native} and who learns ${variantName(params.variant)}, practises one English structure by ${asked}. You label the sentence; the app decides what the labels mean.

The structure is ${structure.name}: ${structure.form}. It is used for ${structure.use}.

Answer with:
- usesStructure: true when the sentence has this structure, even badly formed. False when it uses another structure instead, or when nothing was written.
- wellFormed: true when the structure itself is formed correctly (auxiliary, verb form, word order) and fits what the sentence says. Judge only the structure. False whenever usesStructure is false.
- ${usesWord}
- slips: true when the rest of the sentence has a mistake outside the structure: a misspelling, an article, a preposition, a wrong word. False for a sentence a native speaker would let pass.
- explanation: one or two short lines. When something is wrong, what it is and the rule behind it, quoting the learner's words; when all is right, what makes it right, in one line. Never generic praise. Fault only real mistakes, never wording a native speaker would let pass. Everything it faults is changed in better, and better keeps everything it does not fault.
- better: one correct, natural English sentence that is the learner's own sentence put right, not a new one. All of these hold, the first ones first:
  - It has this structure in exactly the form given above, not a neighbouring structure.${betterWord}
  - It says what the learner tried to say: keep their subject, their people, things and places, their reason, and their own words wherever those words are right. Never add an idea the learner did not write, and never drop one of theirs to make the sentence easier.
  - Only when no correct, natural sentence can say the learner's idea with this structure, change the idea, and then as little as possible.
  When nothing was written, an example sentence.

${REAL_ENGLISH_RULE}

${nativeLanguageRule(params.nativeLang)}`;
}

/** What the learner typed is material to label, whatever it says. */
export function structureGradeUserPrompt(params: StructureGradeParams): string {
  const word = params.word === null ? "" : `<word>${params.word}</word>\n`;
  return `${DATA_NOT_INSTRUCTIONS} The sentence is what the learner typed.

${word}<sentence>${params.answer}</sentence>`;
}

/** Labels which structures a piece of a chapter uses; Rust counts and ranks. */
export function structureDetectSystemPrompt(
  params: StructureDetectParams,
): string {
  const listed = params.structures
    .map((each) => `- ${each.key}: ${each.name}, ${each.form}`)
    .join("\n");
  return `You read a piece of a book an adult English learner is reading and label which of the English structures listed below its sentences use. The app counts and ranks them; you only label.

The structures, each by its key:
${listed}

Answer with found: one entry for each listed structure the text uses, and none for the others. For each:
- key: its key, exactly as listed.
- count: how many sentences of the text use it. A sentence counts once for a structure, however often it has it.
- sentence: one sentence of the text that shows it clearly, copied exactly, letter for letter, and the shortest one that shows it.

Never add a structure that is not listed.`;
}

/** Book text is material to read, whatever it says. */
export function structureDetectUserPrompt(
  params: StructureDetectParams,
): string {
  return `${DATA_NOT_INSTRUCTIONS} It is a piece of a book the learner uploaded.

<text>
${params.text}
</text>`;
}
