import type {
  AttemptSummaryParams,
  ChapterBriefParams,
  ParagraphReviewParams,
  ParagraphVersionParams,
} from "../../shared/protocol.ts";
import {
  DATA_NOT_INSTRUCTIONS,
  LEVEL_CEFR,
  languageName,
  nativeLanguageRule,
} from "./common.ts";

/** What a reviewer of one paragraph has to know of the whole chapter. */
export function chapterBriefSystemPrompt(params: ChapterBriefParams): string {
  const native = languageName(params.nativeLang);
  return `An adult English learner whose language is ${native} translates one chapter of a book, a paragraph at a time. A reviewer will judge each paragraph seeing only that paragraph and the one before it. You are given the whole chapter. Write the brief that lets the reviewer judge any paragraph in its context.

In English, in at most 200 words:
- What happens in the chapter and who is in it, in two or three sentences.
- The voice of the narration: person, tense, register.
- Every word or expression whose right ${native} translation depends on this chapter: a term of the book's world, a word with several senses, a name that is or is not translated. For each one, the ${native} translation that fits here and the one that would be wrong.

Nothing else: no opinion of the book and no advice to the learner.`;
}

/** Book text is material to read, whatever it says. */
export function chapterBriefUserPrompt(params: ChapterBriefParams): string {
  return `${DATA_NOT_INSTRUCTIONS} It is a chapter of a book the learner uploaded.

<text>
${params.text}
</text>`;
}

/** A paragraph in the learner's language, to be put back into English. */
export function paragraphVersionSystemPrompt(
  params: ParagraphVersionParams,
): string {
  const native = languageName(params.nativeLang);
  return `You translate one paragraph of a book into ${native} for an adult English learner. The learner will translate your version back into English and compare it with the author's text, so your version must lead back to that text.

- Stay as close to the author as ${native} allows: the structure of each sentence, the style and register, the meaning and what the author wants the reader to feel.
- It must still be correct, natural ${native}. Where a word-for-word rendering would be wrong or strange ${native}, use the closest wording that is right, and go no further from the original than that.
- Use the chapter brief for any word whose translation depends on the chapter.

The paragraph comes as numbered sentences. Return exactly one ${native} sentence for each, in the same order: never join two, split one or leave one out, even where ${native} would. A piece that ends with a semicolon stays one piece ending with a semicolon.`;
}

function numbered(sentences: readonly string[]): string {
  return sentences
    .map((sentence, at) => `<sentence n="${at}">${sentence}</sentence>`)
    .join("\n");
}

/** The paragraph is material to translate, whatever it says. */
export function paragraphVersionUserPrompt(
  params: ParagraphVersionParams,
): string {
  return `${DATA_NOT_INSTRUCTIONS} The sentences are from a book the learner uploaded.

<brief>
${params.brief}
</brief>

${numbered(params.sentences)}`;
}

/** What the learner did, and what a note may be about. */
function reviewTask(params: ParagraphReviewParams, native: string): string {
  return params.direction === "toNative"
    ? `The learner read a chapter of a book in English and is now translating it into ${native}, a sentence at a time, to see how well they understood it. You review one paragraph they have finished.

Mark what the learner got wrong in what they wrote:
- error: the English was not understood. A word taken in a sense it does not have in this chapter, a meaning lost, changed or added, a structure misread (who does what, the tense, a negation, what a pronoun refers to).
- slip: the ${native} is written wrong though the meaning is there. A misspelling, a missing accent, a typo, a wrong agreement.
A freer wording that keeps the meaning is not wrong and gets no note.`
    : `The learner read a chapter of a book in English, translated it into ${native}, and is now writing it back in English from a faithful ${native} version, a sentence at a time, without seeing the original. You review one paragraph they have finished.

Mark what the learner got wrong in the English they wrote:
- error: the wrong word, a wrong collocation or word order, broken grammar, or English that says something else than the ${native} sentence.
- slip: the right word misspelled, a typo, a capital or an apostrophe missing.
The author's sentence is one right answer, not the only one: correct English that says the same thing gets no note, even where the author chose other words.`;
}

/** Reviews one finished paragraph; Rust places the notes and scores it. */
export function paragraphReviewSystemPrompt(
  params: ParagraphReviewParams,
): string {
  const native = languageName(params.nativeLang);
  const written = params.direction === "toNative" ? native : "English";
  return `You review the work of an adult English learner whose level is ${params.level} (CEFR ${LEVEL_CEFR[params.level]}) and whose language is ${native}.

${reviewTask(params, native)}

Use the chapter brief and the paragraph before to decide a word whose sense depends on the chapter.

Answer with:
- good: one short sentence naming one specific thing the learner did well in this paragraph, or null when nothing stands out. Never generic praise.
- notes: one for each thing that is wrong, in reading order; an empty list when the paragraph is right. A sentence can have several, and their fragments must not overlap. For each:
  - sentence: the n of the sentence, as given.
  - fragment: the words of the attempt that are wrong, copied exactly as the learner typed them, letter for letter, and as few words as hold the mistake. It is highlighted in the learner's text, so it must be found there. For something left out, copy the word of the attempt next to where it is missing.
  - severity: "error" or "slip", as defined above.
  - better: what the fragment should have been, in ${written}.
  - why: one short line saying what went wrong and the sense or rule behind it, quoting the English words it is about.
  - word: when the mistake comes from one English word or expression the learner did not know or could not recall, that word: english is its base form in lowercase ("run" for "ran", "give up" for "gave up"), translations are its natural ${native} translations in the sense it has here, at least one. Otherwise null: grammar, spelling and word order have no word.

${nativeLanguageRule(params.nativeLang)}`;
}

function reviewed(
  line: ParagraphReviewParams["sentences"][number],
  at: number,
): string {
  const shown = line.native === null ? "" : `\n<shown>${line.native}</shown>`;
  return `<sentence n="${at}">
<author>${line.english}</author>${shown}
<attempt>${line.attempt}</attempt>
</sentence>`;
}

/** The book and the attempts are material to judge, whatever they say. */
export function paragraphReviewUserPrompt(
  params: ParagraphReviewParams,
): string {
  return `${DATA_NOT_INSTRUCTIONS} The author's sentences are from a book the learner uploaded; each attempt is what the learner typed.

<brief>
${params.brief}
</brief>

<previous>${params.previous}</previous>

${params.sentences.map(reviewed).join("\n")}`;
}

/** What matters most of a whole attempt, and what came back in it. */
export function attemptSummarySystemPrompt(
  params: AttemptSummaryParams,
): string {
  const native = languageName(params.nativeLang);
  const way =
    params.direction === "toNative"
      ? `from English into ${native}`
      : `from ${native} back into English`;
  return `An adult English learner whose level is ${params.level} (CEFR ${LEVEL_CEFR[params.level]}) and whose language is ${native} has translated part of a chapter of a book ${way}. Each paragraph was reviewed, and you are given every note of those reviews: the fragment the learner wrote, what it should have been, why, and whether it was an error or a slip.

Write the summary the learner reads first, before the detail of each paragraph. It must say what to work on to translate better, not repeat the notes.

Answer with:
- points: the two or three things that matter most across the whole attempt, each one sentence, the most important first. Say what the learner should focus on, concretely.
- habits: the mistakes that came back, at most three, the most frequent first. A habit is the same kind of mistake made several times: a word mistranslated again and again, a structure always rendered the same wrong way, a spelling vice. A mistake made once is not a habit; return an empty list when nothing came back. For each:
  - habit: what the learner keeps doing, in a few words.
  - advice: what to do instead, in one or two short lines.
  - examples: two or three fragments that show it, copied exactly from the notes.

${nativeLanguageRule(params.nativeLang)}`;
}

/** The notes are material to summarise, whatever they say. */
export function attemptSummaryUserPrompt(params: AttemptSummaryParams): string {
  const notes = params.notes
    .map(
      (note) =>
        `<note severity="${note.severity}">
<wrote>${note.fragment}</wrote>
<better>${note.better}</better>
<why>${note.why}</why>
</note>`,
    )
    .join("\n");
  return `${DATA_NOT_INSTRUCTIONS} The fragments are what the learner typed.

${notes}`;
}
