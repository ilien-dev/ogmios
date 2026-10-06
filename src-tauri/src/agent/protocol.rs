//! Typed mirror of `shared/protocol.ts`. On disagreement the TypeScript wins:
//! the sidecar validates with zod and rejects anything else.

use serde::{Deserialize, Serialize};

use crate::domain::{
    Cefr, DrillFormat, Effort, ErrorKind, Goal, HelpOption, Level, NativeRewrite, ProviderMode,
    Role, SessionSetup, Variant,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureParams {
    pub mode: ProviderMode,
    pub model: String,
    pub effort: Option<Effort>,
    pub api_key: Option<String>,
    pub claude_path: Option<String>,
}

/// What `configure` answers: the fingerprint of the `shared/protocol.ts` the
/// sidecar was built from.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Configured {
    pub protocol: u32,
}

// ── chat ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Learner {
    pub name: Option<String>,
    pub native_lang: String,
    pub goal: Goal,
    pub variant: Variant,
    pub interests: Vec<String>,
    pub facts: Vec<String>,
    pub cefr: Option<Cefr>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub description: String,
    pub contexts: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatContext {
    pub setup: SessionSetup,
    pub learner: Learner,
    pub targets: Vec<Target>,
    pub challenge: Option<String>,
    /// How the partner opened the sessions before this one, newest first.
    pub recent_openings: Vec<String>,
    /// Phrases from recorded speech for the partner to use; empty when there
    /// is no evidence for this learner's goal, level or variant.
    pub phrases: Vec<String>,
    /// Words the learner has learned, for the partner to use where they
    /// fit: meeting them in a conversation is what makes them stay.
    pub words: Vec<String>,
    /// The conversation this one continues, when the learner asked for that.
    pub previous: Option<PreviousSession>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousSession {
    pub topic: String,
    /// Its last turns, oldest first.
    pub turns: Vec<HistoryTurn>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTurn {
    pub role: Role,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatParams {
    pub context: ChatContext,
    pub history: Vec<HistoryTurn>,
    pub provider_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResult {
    pub text: String,
    /// The partner's openers for the learner's answer; `session::scaffolds`
    /// decides what is shown.
    #[serde(default)]
    pub starters: Vec<String>,
    pub provider_ref: Option<String>,
}

// ── help ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpParams {
    pub native_lang: String,
    pub text: String,
    pub recent: String,
    pub variant: Variant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpResult {
    pub options: Vec<HelpOption>,
}

// ── analyze ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeTurn {
    pub id: String,
    pub role: Role,
    pub said: Option<String>,
    pub sent: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownPattern {
    pub id: String,
    pub key: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeRef {
    pub pattern_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeParams {
    pub level: Level,
    pub cefr: Option<Cefr>,
    pub native_lang: String,
    pub goal: Goal,
    pub variant: Variant,
    pub turns: Vec<AnalyzeTurn>,
    pub patterns: Vec<KnownPattern>,
    pub challenge: Option<ChallengeRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternRef {
    pub existing_id: Option<String>,
    pub new_key: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisError {
    pub turn_id: String,
    pub original: String,
    pub corrected: String,
    pub kind: ErrorKind,
    pub global: bool,
    pub rule_based: bool,
    pub above_level: bool,
    pub pattern: PatternRef,
    pub confidence: f64,
    pub asr_suspect: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectUse {
    pub turn_id: String,
    pub pattern_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditType {
    AsrFix,
    SelfCorrection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub turn_id: String,
    #[serde(rename = "type")]
    pub kind: EditType,
    pub before: String,
    pub after: String,
    pub pattern_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CouldHaveSaid {
    pub turn_id: String,
    pub original: String,
    pub better: String,
    pub why: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Complexity {
    pub clauses_per_unit: Option<f64>,
    pub subordination_ratio: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CefrRubric {
    pub range: Cefr,
    pub accuracy: Cefr,
    pub fluency: Cefr,
    pub interaction: Cefr,
    pub coherence: Cefr,
    pub overall: Cefr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub errors: Vec<AnalysisError>,
    pub correct_uses: Vec<CorrectUse>,
    pub edits: Vec<Edit>,
    pub could_have_said: Vec<CouldHaveSaid>,
    pub native_rewrite: Option<NativeRewrite>,
    pub strengths: Vec<String>,
    pub best_sentence_turn_id: Option<String>,
    pub best_sentence: Option<String>,
    pub complexity: Complexity,
    pub cefr: CefrRubric,
    pub profile_facts: Vec<String>,
    pub partner_vocabulary: Vec<HelpOption>,
    pub challenge_achieved: Option<bool>,
}

// ── compose ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionInput {
    pub item_id: String,
    pub original: String,
    pub corrected: String,
    pub kind: ErrorKind,
    pub pattern_description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusInput {
    pub description: String,
    pub example: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeParams {
    pub native_lang: String,
    pub level: Level,
    pub corrections: Vec<CorrectionInput>,
    pub focus: Option<FocusInput>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposedCorrection {
    pub item_id: String,
    pub highlight: String,
    pub explanation: String,
    pub hint: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposedChallenge {
    pub text: String,
    pub target_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Composed {
    pub corrections: Vec<ComposedCorrection>,
    pub challenge: Option<ComposedChallenge>,
}

// ── self-check ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheckParams {
    pub native_lang: String,
    pub original: String,
    pub corrected: String,
    pub attempt: String,
}

// ── drills ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Example {
    pub original: String,
    pub corrected: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillPattern {
    pub id: String,
    pub description: String,
    pub examples: Vec<Example>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillGenerateParams {
    pub native_lang: String,
    pub level: Level,
    pub format: DrillFormat,
    pub patterns: Vec<DrillPattern>,
    pub blocked: u32,
    pub mixed: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedDrillItem {
    pub format: DrillFormat,
    pub pattern_id: String,
    pub prompt: String,
    pub instruction: String,
    pub options: Vec<String>,
    pub answer: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillSet {
    pub items: Vec<GeneratedDrillItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillGradeParams {
    pub native_lang: String,
    pub item: GeneratedDrillItem,
    pub response: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillGrade {
    pub correct: bool,
    pub explanation: String,
    pub expected: String,
}

// ── book vocabulary ───────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabExtractParams {
    pub native_lang: String,
    pub level: Level,
    pub depth: crate::domain::Depth,
    /// One piece of a chapter, as plain English text.
    pub text: String,
}

/// One word as the model labels it; what is kept is decided in
/// `books::vocab`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabItem {
    pub lemma: String,
    pub form: String,
    pub sentence: String,
    pub part_of_speech: crate::domain::PartOfSpeech,
    /// A verb that takes an object in that sentence.
    pub transitive: bool,
    pub translations: Vec<String>,
    pub proper_noun: bool,
    pub needs_context: bool,
    /// The form a verb has in that sentence; none for any other word, and
    /// for a piece answered before this was asked for.
    #[serde(default)]
    pub verb_form: Option<crate::domain::VerbForm>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vocab {
    pub items: Vec<VocabItem>,
}

/// "I was right": a missed answer the learner stands by.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabJudgeParams {
    pub native_lang: String,
    pub direction: crate::domain::Direction,
    /// The English word as the learner was asked it: its base form, or,
    /// asked English → native with a sentence of its bank, the form that
    /// sentence has it in.
    pub lemma: String,
    ///The sentence of the book the word was taken from.
    pub sentence: String,
    /// The translations accepted so far, in the learner's language.
    pub translations: Vec<String>,
    /// What the learner typed, as they typed it.
    pub answer: String,
    /// The learner asked for accents and spelling to count.
    pub strict_spelling: bool,
    /// What fills the blank the answer was typed into, for a word asked
    /// native → English with a sentence of its bank: only an answer in that
    /// exact form is right. None otherwise.
    pub blank: Option<String>,
}

/// The model's label; what an upheld answer changes is decided in
/// `commands::dispute`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabVerdict {
    pub correct: bool,
    /// One line in the learner's language saying why.
    pub reason: String,
}

/// One word stored without its kind, to be said what kind it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelWord {
    /// Names the word in the answer: its id.
    pub id: String,
    /// The English word, as it is stored.
    pub lemma: String,
    /// The sentence of the book it was taken from.
    pub sentence: String,
    /// The translations of a verb called by another form than its base
    /// form, to be put in that form; empty for a word that has them so, and
    /// for any other word.
    pub translations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabLabelParams {
    pub words: Vec<LabelWord>,
}

/// The model's label on one word.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordLabel {
    pub id: String,
    pub part_of_speech: crate::domain::PartOfSpeech,
    /// A verb that takes an object in its sentence.
    pub transitive: bool,
    /// The form a verb has in its sentence; none for any other word.
    pub verb_form: Option<crate::domain::VerbForm>,
    /// The translations it was given, each in the form of the word, in the
    /// order they came; empty when none was given.
    pub in_form: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabLabels {
    pub labels: Vec<WordLabel>,
}

// ── sentences a word is asked with ────────────────────────────────────────

/// One word whose sentences of the book are to be glossed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceWord {
    /// Names the word in the answer: its key.
    pub id: String,
    /// The English base form.
    pub lemma: String,
    pub part_of_speech: Option<crate::domain::PartOfSpeech>,
    /// What it means, in the learner's language.
    pub translations: Vec<String>,
    /// A sentence that fixes the sense the word has in its chapter.
    pub sense: String,
    /// Sentences of the book that have the word, to be glossed.
    pub book: Vec<String>,
}

/// No sentence is written: the model glosses those the book has.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceWriteParams {
    pub native_lang: String,
    pub words: Vec<SentenceWord>,
}

/// What the model says of one sentence of the book.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookGloss {
    pub index: u32,
    /// The words of `translation` that stand for the word, copied from it.
    pub hint: String,
    pub translation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenWord {
    pub id: String,
    pub book: Vec<BookGloss>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentencesWritten {
    pub words: Vec<WrittenWord>,
}

/// One sentence put to the second look.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedSentence {
    pub id: String,
    pub lemma: String,
    pub meaning: Vec<String>,
    pub sentence: String,
    pub form: String,
    pub hint: String,
    pub translation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceReviewParams {
    pub native_lang: String,
    pub sentences: Vec<ReviewedSentence>,
}

/// The model's label on one sentence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceVerdict {
    pub id: String,
    pub good: bool,
    /// The other English words the hint could be answered with.
    pub also: Vec<String>,
    /// The word's other translations, in the form the hint has.
    pub hints: Vec<String>,
    /// The form a verb has in the sentence; none for any other word.
    pub verb_form: Option<crate::domain::VerbForm>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceVerdicts {
    pub verdicts: Vec<SentenceVerdict>,
}

// ── chapter translation ───────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterBriefParams {
    pub native_lang: String,
    /// The chapter, as plain English text.
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterBrief {
    /// What a reviewer of any paragraph needs to know of the chapter.
    pub brief: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphVersionParams {
    pub native_lang: String,
    pub brief: String,
    /// The paragraph, a sentence each, in order.
    pub sentences: Vec<String>,
}

/// Whether it matches the paragraph is checked in `books::translate`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphVersion {
    /// One per sentence given, in the same order.
    pub sentences: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSentence {
    /// The author's sentence.
    pub english: String,
    /// What the learner was shown instead, translating back into English.
    pub native: Option<String>,
    /// What the learner wrote.
    pub attempt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphReviewParams {
    pub native_lang: String,
    pub level: Level,
    pub direction: crate::domain::TranslationDirection,
    /// The learner asked for accents and spelling to count.
    pub strict_spelling: bool,
    pub brief: String,
    /// The paragraph before this one, in English; empty for the first.
    pub previous: String,
    pub sentences: Vec<ReviewSentence>,
}

/// The English word a note is about, with its translations for that sense.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteWord {
    pub english: String,
    pub translations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphNote {
    /// Which sentence, counted from 0.
    pub sentence: u32,
    /// The words of the learner's sentence that are wrong, copied exactly.
    pub fragment: String,
    pub severity: crate::domain::Severity,
    /// What the fragment should have been.
    pub better: String,
    /// Why, in the learner's language.
    pub why: String,
    /// The word to practise, when the note is about one.
    pub word: Option<NoteWord>,
}

/// The model's labels; where each note goes in the learner's text and what
/// the paragraph scores is decided in `books::translate`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphReview {
    pub good: Option<String>,
    pub notes: Vec<ParagraphNote>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryNote {
    pub fragment: String,
    pub severity: crate::domain::Severity,
    pub better: String,
    pub why: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummaryParams {
    pub native_lang: String,
    pub level: Level,
    pub direction: crate::domain::TranslationDirection,
    /// Every note of every paragraph of the attempt, in reading order.
    pub notes: Vec<SummaryNote>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryHabit {
    pub habit: String,
    pub advice: String,
    pub examples: Vec<String>,
}

/// As the model wrote it; how much of it is kept is decided in
/// `books::translate`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummary {
    pub points: Vec<String>,
    pub habits: Vec<SummaryHabit>,
}

// ── structures ────────────────────────────────────────────────────────────

/// One structure of the catalogue, as the model is told it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureRef {
    pub key: String,
    pub name: String,
    pub form: String,
    #[serde(rename = "use")]
    pub usage: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureGradeParams {
    pub native_lang: String,
    pub level: Level,
    pub variant: Variant,
    pub structure: StructureRef,
    /// The word the learner was asked to use; none when none was.
    pub word: Option<String>,
    /// What kind of word it is; none when none was asked or nobody said.
    pub part_of_speech: Option<crate::domain::PartOfSpeech>,
    /// The sentence as the learner typed it; empty when they wrote none.
    pub answer: String,
}

/// The model's labels; the verdict is decided in `structures::verdict`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureGrade {
    pub uses_structure: bool,
    pub well_formed: bool,
    pub uses_word: bool,
    pub slips: bool,
    pub explanation: String,
    pub better: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureDetectParams {
    pub structures: Vec<StructureRef>,
    /// One piece of a chapter, as plain English text.
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureFound {
    pub key: String,
    /// Sentences of the piece that use it.
    pub count: u32,
    /// One of them, copied from the text.
    pub sentence: String,
}

/// The model's labels; counted over the chapter in `structures::rank`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuresFound {
    pub found: Vec<StructureFound>,
}
