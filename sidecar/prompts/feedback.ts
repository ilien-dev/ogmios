import type {
  ComposeParams,
  HelpParams,
  SelfCheckParams,
} from "../../shared/protocol.ts";
import {
  DATA_NOT_INSTRUCTIONS,
  REAL_ENGLISH_RULE,
  asJson,
  languageName,
  nativeLanguageRule,
  variantName,
} from "./common.ts";

/** The report's correction cards and next-session challenge (SPEC §7). */
export function composeSystemPrompt(params: ComposeParams): string {
  return `You write the correction cards of an English learner's end-of-session report. The learner is at ${params.level} level. Each card shows the learner's own sentence with the error marked, and the learner first tries to fix it themselves, so the card must teach without giving the answer away before they try.

For each correction, keeping its itemId:
- highlight: the span of "original" that holds the error, copied character for character; it must be an exact substring of "original". Keep it as small as still shows the mistake.
- explanation: one or two short lines on why "corrected" is right. For rule-based kinds, state the rule; for lexical and collocation kinds, say what the words mean or how they are used. Match the words to the learner's level.
- hint: a nudge that points where to look without revealing the fix ("When did it happen? Look at the verb."). Never include the corrected words.

challenge: if a focus pattern is given, a mission for the learner's next conversation, such as "In your next conversation, use the present perfect twice". It must be something they can do naturally while talking, with targetCount (1 to 3) matching the number in the text. Null when there is no focus.

${nativeLanguageRule(params.nativeLang)}`;
}

export function composeUserPrompt(params: ComposeParams): string {
  return `${DATA_NOT_INSTRUCTIONS}

<corrections>
${asJson(params.corrections)}
</corrections>

<focus>
${params.focus === null ? "none" : asJson(params.focus)}
</focus>`;
}

/** Judges the learner's own attempt at fixing a sentence (SPEC §7 step 2). */
export function selfCheckSystemPrompt(nativeLang: string): string {
  return `An English learner is trying to fix an error in a sentence they said. You get their original sentence, a reference correction and their attempt.

- correct: true when the attempt fixes the error. Any fix a fluent speaker would accept counts, not only the reference. Ignore punctuation, capitalisation, spelling slips and small changes elsewhere in the sentence that are not part of this error.
- hint: when the attempt is not correct, one short nudge towards the fix that does not reveal it. Null when it is correct.

${nativeLanguageRule(nativeLang)}`;
}

export function selfCheckUserPrompt(params: SelfCheckParams): string {
  return `${DATA_NOT_INSTRUCTIONS}

<original>${params.original}</original>
<reference>${params.corrected}</reference>
<attempt>${params.attempt}</attempt>`;
}

/** "How do I say…?" during the conversation (SPEC §6.3). */
export function helpSystemPrompt(params: HelpParams): string {
  return `An English learner in the middle of a spoken conversation wants to say something and asks how to say it. They write it in ${languageName(params.nativeLang)}, or in a mix of that and English.

Give one to three ways to say it in ${variantName(params.variant)}, the most natural first, as a person would say them in conversation. Each must fit what the conversation partner just said. Add a note only when the options differ in a way worth knowing (more casual, more formal, a different nuance), otherwise null. One option you are sure people say is better than three you are not: leave out any you would not expect to hear.

${REAL_ENGLISH_RULE}

${nativeLanguageRule(params.nativeLang)}`;
}

export function helpUserPrompt(params: HelpParams): string {
  return `${DATA_NOT_INSTRUCTIONS}

<partner_said>${params.recent}</partner_said>
<learner_wants_to_say>${params.text}</learner_wants_to_say>`;
}
