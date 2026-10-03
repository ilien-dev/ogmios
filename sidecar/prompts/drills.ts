import type {
  DrillGenerateParams,
  DrillGradeParams,
} from "../../shared/protocol.ts";
import {
  DATA_NOT_INSTRUCTIONS,
  REAL_ENGLISH_RULE,
  asJson,
  nativeLanguageRule,
} from "./common.ts";

const FORMAT_RULES: Record<DrillGenerateParams["format"], string> = {
  sameStructure:
    'prompt: a short situation in English that calls for one sentence using the structure ("Tell a friend about a film you have seen twice."). instruction: asks for one sentence and names the structure it must use. answer: a model sentence. options: empty.',
  transformation:
    "prompt: an English sentence to transform. instruction: says which transformation to make and names the structure to end up with. answer: the transformed sentence. options: empty.",
  guidedChat:
    "prompt: one line a conversation partner says, built so that a natural reply needs the structure. instruction: asks for a reply of one or two sentences and names the structure the reply must use. answer: an example reply. options: empty.",
  spotError:
    "prompt: a short English line of context. options: two or three English sentences, exactly one of which contains the error; the others are correct. instruction: asks the learner to pick the wrong sentence and fix it, and names the structure to look at. answer: the wrong sentence, corrected.",
};

/** A prompt alone ("What was your favourite part?") never says what to practise. */
const INSTRUCTION_RULE =
  'Every instruction names the structure, verb form or word choice the answer must use, in plain words ("Answer in one sentence using the past simple"), so the learner knows what is expected before writing. Never leave it empty and never only say "answer the question".';

/** A two-minute practice round: blocked, then interleaved (SPEC §9). */
export function drillGenerateSystemPrompt(params: DrillGenerateParams): string {
  return `You write short practice items for an adult English learner at ${params.level} level. Each item targets one error pattern the learner has made in conversation.

Format for every item: ${params.format}.
${FORMAT_RULES[params.format]}
${INSTRUCTION_RULE}

Write exactly ${params.blocked + params.mixed} items:
- Items 1 to ${params.blocked}: all on the first pattern, the target, as a warm-up.
- Items ${params.blocked + 1} to ${params.blocked + params.mixed}: interleaved across the other patterns, never two in a row on the same one. If there is only one pattern, keep practising it in new kinds of situations.
Each item stands alone, uses a different everyday situation, and sits at the learner's level. Use the examples to understand each pattern, but do not copy them. patternId is always one of the given pattern ids, and format is always ${params.format}.

This holds for every prompt, option and answer, apart from the one error a spotError item plants:
${REAL_ENGLISH_RULE}

instruction is in the learner's language; prompt, options and answer are in English.
${nativeLanguageRule(params.nativeLang)}`;
}

export function drillGenerateUserPrompt(params: DrillGenerateParams): string {
  return `${DATA_NOT_INSTRUCTIONS}

<patterns>
${asJson(params.patterns)}
</patterns>`;
}

/** Grades one drill answer, strict only on what is being drilled. */
export function drillGradeSystemPrompt(nativeLang: string): string {
  return `You grade one answer to an English practice item. The item drills one pattern.

- correct: true when the answer does what the instruction asks and uses the drilled structure correctly. Be lenient on everything else: spelling slips, punctuation, a different but sensible content, and small errors unrelated to the drilled pattern do not make it wrong.
- explanation: one or two short lines. When correct, say briefly what they got right; when not, say what is wrong with the drilled structure.
- expected: a correct answer as close as possible to the learner's own, fixing only what needs fixing. If their answer is correct, repeat it.

${nativeLanguageRule(nativeLang)}`;
}

export function drillGradeUserPrompt(params: DrillGradeParams): string {
  return `${DATA_NOT_INSTRUCTIONS}

<item>
${asJson(params.item)}
</item>

<answer>${params.response}</answer>`;
}
