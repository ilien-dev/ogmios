//! Types that cross the Tauri bridge. Mirror of `shared/domain.ts`; on any
//! disagreement this file wins and the TypeScript is fixed.

use serde::{Deserialize, Serialize};

/// A string-valued enum: serde, SQLite, `as_str` and `parse` from one
/// spelling list.
macro_rules! wire_enum {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $text)] $variant),+ }

        impl $name {
            /// The spelling used on the wire and in SQLite.
            pub fn as_str(self) -> &'static str {
                match self { $($name::$variant => $text),+ }
            }

            pub fn parse(text: &str) -> Option<Self> {
                match text { $($text => Some($name::$variant),)+ _ => None }
            }
        }

        impl rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl rusqlite::types::FromSql for $name {
            fn column_result(
                value: rusqlite::types::ValueRef<'_>,
            ) -> rusqlite::types::FromSqlResult<Self> {
                let text = value.as_str()?;
                Self::parse(text).ok_or_else(|| {
                    rusqlite::types::FromSqlError::Other(
                        format!("not a {}: {text}", stringify!($name)).into(),
                    )
                })
            }
        }
    };
}

// In order of depth: a later one asks for more of the chapter's words.
wire_enum!(Depth { Hardest => "hardest", Relevant => "relevant", Most => "most" });
// What kind of word a chapter's word is, in the sense its sentence gives it.
wire_enum!(PartOfSpeech {
    Noun => "noun",
    Verb => "verb",
    PhrasalVerb => "phrasalVerb",
    Adjective => "adjective",
    Adverb => "adverb",
    Expression => "expression",
    Other => "other",
});
// The form a verb has in the sentence it is asked with.
wire_enum!(VerbForm {
    Base => "base",
    Present => "present",
    Past => "past",
    PastParticiple => "pastParticiple",
    Ing => "ing",
});
// Which way a word is asked: English → native, or native → English.
wire_enum!(Direction { Recognition => "recognition", Production => "production" });
// The ways a session of practice asks its words in: both, or one alone.
wire_enum!(Ways { Both => "both", Recognition => "recognition", Production => "production" });
// How strong a learned word is, by how long it has held (`memory::recall`).
wire_enum!(Strength { New => "new", Settling => "settling", Firm => "firm" });
// Which way a chapter is translated: into the learner's language, or back.
wire_enum!(TranslationDirection { ToNative => "toNative", ToEnglish => "toEnglish" });
// How much a mistake weighs: a wrong translation, or a slip of the pen.
wire_enum!(Severity { Error => "error", Slip => "slip" });
wire_enum!(Level { Basic => "basic", Intermediate => "intermediate", Advanced => "advanced" });
wire_enum!(Cefr { A1 => "A1", A2 => "A2", B1 => "B1", B2 => "B2", C1 => "C1", C2 => "C2" });
wire_enum!(Goal { Work => "work", Travel => "travel", Exams => "exams", Social => "social", Other => "other" });
wire_enum!(Variant { Us => "us", Uk => "uk" });
// How fast a sentence is read aloud, slowest first: each one is a level of
// the listening practice.
wire_enum!(Pace { Slow => "slow", Normal => "normal", Fast => "fast" });
// What a finished dictation suggests about the pace of the next.
wire_enum!(PaceHint { Slower => "slower", Faster => "faster" });
// What a sentence written with a structure is worth: the verdict scale.
wire_enum!(StructureVerdict { Correct => "correct", Partial => "partial", Wrong => "wrong" });
// Where a word a sentence is asked to use was met: the chapter being read,
// or the words learned before.
wire_enum!(WordSource { Chapter => "chapter", Recall => "recall" });
wire_enum!(UiLang { En => "en", Es => "es" });
wire_enum!(Mode {
    Casual => "casual", Interview => "interview", Debate => "debate",
    Story => "story", Roleplay => "roleplay", Material => "material",
});
wire_enum!(Personality {
    CuriousFriend => "curiousFriend", StrictInterviewer => "strictInterviewer",
    Coworker => "coworker", Contrarian => "contrarian",
});
wire_enum!(FocusMode { Free => "free", Pending => "pending" });
wire_enum!(ProviderMode { ApiKey => "apiKey", ClaudeCode => "claudeCode" });
wire_enum!(Effort { Low => "low", Medium => "medium", High => "high", Xhigh => "xhigh", Max => "max" });
wire_enum!(PatternState {
    Detected => "detected", Focus => "focus", Improving => "improving",
    Mastered => "mastered", Relapse => "relapse",
});
wire_enum!(ErrorKind {
    GrammarRule => "grammarRule", Lexical => "lexical", Collocation => "collocation",
    WordOrder => "wordOrder", Register => "register", Pronoun => "pronoun", Other => "other",
});
wire_enum!(DrillFormat {
    SameStructure => "sameStructure", Transformation => "transformation",
    GuidedChat => "guidedChat", SpotError => "spotError",
});
wire_enum!(Modality { Voice => "voice", Text => "text", Mixed => "mixed" });

impl Cefr {
    /// The UI level this CEFR band belongs to.
    pub fn level(self) -> Level {
        match self {
            Cefr::A1 | Cefr::A2 => Level::Basic,
            Cefr::B1 | Cefr::B2 => Level::Intermediate,
            Cefr::C1 | Cefr::C2 => Level::Advanced,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: Option<String>,
    pub native_lang: String,
    pub ui_lang: UiLang,
    pub goal: Goal,
    pub variant: Variant,
    pub interests: Vec<String>,
    pub level: Level,
    pub reminder_time: Option<String>,
    pub onboarded: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFact {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub provider_mode: ProviderMode,
    pub model: String,
    /// `None` lets the sidecar choose per call.
    pub effort: Option<Effort>,
    pub claude_path: Option<String>,
    pub stt_model: Option<String>,
    /// Accents and spelling count in what the learner types; off by default.
    pub strict_spelling: bool,
}

/// A model the configured provider offers, as the provider describes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub efforts: Vec<Effort>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCheck {
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSetup {
    pub topic: String,
    pub level: Level,
    pub mode: Mode,
    pub personality: Personality,
    pub focus_mode: FocusMode,
    pub target_minutes: Option<f64>,
    pub material: Option<String>,
    /// Picks up where the last conversation ended. Set-ups stored before it
    /// existed do not have it.
    #[serde(default)]
    pub continue_previous: bool,
}

wire_enum!(Role { User => "user", Assistant => "assistant" });

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: String,
    pub role: Role,
    pub sent_text: String,
    pub said_text: Option<String>,
    pub speech_seconds: Option<f64>,
    pub words: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStarted {
    pub session_id: String,
    pub opening: Turn,
    pub length_hint: String,
    pub turn_word_goal: u32,
    pub scaffolds: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnReply {
    pub user_turn: Turn,
    pub reply: Turn,
    pub length_hint: String,
    pub scaffolds: Vec<String>,
    pub speech_minutes: f64,
    pub target_reached: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDelta {
    pub session_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpOption {
    pub english: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternView {
    pub id: String,
    pub description: String,
    pub kind: ErrorKind,
    pub state: PatternState,
    pub correct_rate: Option<f64>,
    pub sessions_seen: u32,
    pub next_review_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Streak {
    pub days: u32,
    pub freezes_left: u32,
    pub practiced_today: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeState {
    pub profile: Profile,
    pub last_setup: Option<SessionSetup>,
    /// Topic of the conversation a new one can continue, when there is one.
    pub continue_topic: Option<String>,
    pub suggested_topics: Vec<String>,
    pub focus: Option<PatternView>,
    pub due_reviews: u32,
    /// Learned words the daily recall has to ask today.
    pub due_words: u32,
    pub streak: Streak,
    pub active_challenge: Option<String>,
    pub rotation_suggestion: Option<Mode>,
    pub level_suggestion: Option<Level>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetrics {
    pub modality: Modality,
    pub speech_minutes: f64,
    pub user_words: u32,
    pub user_share: f64,
    pub words_per_turn: f64,
    pub mtld: Option<f64>,
    pub errors_per100: f64,
    pub global_errors_per100: f64,
    pub clauses_per_unit: Option<f64>,
    pub subordination_ratio: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rewrite {
    pub original: String,
    pub better: String,
    pub why: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteNote {
    pub from: String,
    pub to: String,
    pub why: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRewrite {
    pub original: String,
    pub rewrite: String,
    /// Absent in reports and analyses stored before notes existed.
    #[serde(default)]
    pub notes: Vec<RewriteNote>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabItem {
    pub asked: Option<String>,
    pub english: String,
    pub note: Option<String>,
}

wire_enum!(CorrectionRole { Focus => "focus", Minor => "minor" });

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ReportCard {
    Achievement {
        strengths: Vec<String>,
        best_sentence: Option<String>,
        self_corrections: Vec<String>,
    },
    Correction {
        role: CorrectionRole,
        item_id: String,
        pattern_id: String,
        original: String,
        highlight: String,
        corrected: String,
        explanation: String,
        hint: String,
        self_correct: bool,
        recurrence: Option<String>,
    },
    CouldHaveSaid {
        items: Vec<Rewrite>,
        native_rewrite: Option<NativeRewrite>,
    },
    Vocabulary {
        items: Vec<VocabItem>,
    },
    Metrics {
        current: SessionMetrics,
        previous: Option<SessionMetrics>,
        estimated_cefr: Option<Cefr>,
    },
    Challenge {
        text: String,
        previous_achieved: Option<bool>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub session_id: String,
    pub cards: Vec<ReportCard>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnalysisStep {
    Analyzing,
    Composing,
    Done,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProgress {
    pub session_id: String,
    pub step: AnalysisStep,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheck {
    pub correct: bool,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillItem {
    pub index: u32,
    pub format: DrillFormat,
    pub pattern_id: String,
    /// What the item drills: its pattern's description; empty if unknown.
    pub focus: String,
    pub prompt: String,
    pub instruction: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Drill {
    pub id: String,
    pub items: Vec<DrillItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillResult {
    pub correct: bool,
    pub explanation: String,
    pub expected: String,
    pub retry: Option<DrillItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub started_at: String,
    pub topic: String,
    pub mode: Mode,
    pub level: Level,
    pub speech_minutes: f64,
    pub has_report: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekMinutes {
    pub week: String,
    pub minutes: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CefrPoint {
    pub date: String,
    pub cefr: Cefr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatedText {
    pub date: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabEntry {
    pub asked: Option<String>,
    pub english: String,
    pub date: String,
    /// How strong it is in the daily recall; none for a word it does not ask.
    pub strength: Option<Strength>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint {
    #[serde(flatten)]
    pub metrics: SessionMetrics,
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub patterns: Vec<PatternView>,
    pub weekly_minutes: Vec<WeekMinutes>,
    pub cefr_history: Vec<CefrPoint>,
    pub best_sentences: Vec<DatedText>,
    pub vocabulary: Vec<VocabEntry>,
    pub trend: Vec<TrendPoint>,
    pub sessions: Vec<SessionSummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttModel {
    pub id: String,
    pub name: String,
    pub bytes: u64,
    pub languages: Vec<String>,
    pub downloaded: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttStatus {
    pub available: bool,
    pub models: Vec<SttModel>,
    pub selected: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttDownload {
    pub model_id: String,
    pub received: u64,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttLevel {
    pub peak: f32,
    pub speech_seconds: f64,
}

/// Event `stt-partial`: everything said so far, while the learner speaks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttPartial {
    pub text: String,
}

/// Someone the voice that reads aloud can sound like.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    pub id: String,
    pub name: String,
    pub variant: Variant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatus {
    /// What the one model weighs, downloaded or not.
    pub bytes: u64,
    pub downloaded: bool,
    pub voices: Vec<TtsVoice>,
    /// The voice in use: the learner's pick, or the first of their English.
    pub voice: String,
    /// Off, nothing is read aloud until asked for.
    pub enabled: bool,
}

/// Event `tts-download`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsDownload {
    pub received: u64,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub text: String,
    pub audio_id: String,
    pub speech_seconds: f64,
}

/// A newer release than the one running, as `latest.json` describes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

/// An uploaded book and its chapters in reading order. Chapter text stays in
/// Rust until the chapter is translated (`Translation`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub index: u32,
    /// Empty when the book gives this part no name and the learner has not
    /// given it one: the interface then calls it by its place in the book.
    pub title: String,
    pub words: u32,
    /// The deepest depth its words were taken at; none before it is prepared.
    pub prepared: Option<Depth>,
    /// The share of its words that are done or known, as a percentage; none
    /// before it is prepared. 100, and only 100, is ready to read.
    pub readiness: Option<u32>,
}

/// One word of a prepared chapter. Its sentence stays in Rust.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookWord {
    pub id: String,
    /// What the word is called: its base form, or a form of a verb.
    pub lemma: String,
    /// What kind of word it is; none for a word prepared before words were
    /// labelled, or added outside a preparation.
    pub part_of_speech: Option<PartOfSpeech>,
    /// Accepted translations in the learner's language, the first one first.
    pub translations: Vec<String>,
    /// How often it occurs in the chapter.
    pub count: u32,
    /// Finished in both directions.
    pub done: bool,
    /// How strong it is in the daily recall; none until it is learned.
    pub strength: Option<Strength>,
    /// The one direction it is finished in while it still owes the other;
    /// none for a done word, and for one finished in neither.
    pub half: Option<Direction>,
    /// The learner said they know it already: it is not asked, here or in
    /// any other chapter, until they take that back.
    pub known: bool,
    /// The learner, sorting the chapter's list, left it to learn: the next
    /// sorting starts after it, until another pass is asked for.
    pub sorted: bool,
}

/// A chapter and its words, most frequent first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterWords {
    pub chapter: Chapter,
    pub words: Vec<BookWord>,
}

/// A word the learner said they know already, whatever chapter it came from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownWord {
    /// What the word is known by, in every chapter of every book.
    pub key: String,
    /// What the word is called: its base form, or a form of a verb.
    pub lemma: String,
    /// Its translations in a chapter that has it; none once its books are gone.
    pub translations: Vec<String>,
}

/// Event `chapter-progress`: pieces of the chapter read so far.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterProgress {
    pub chapter_id: String,
    pub done: u32,
    pub total: u32,
}

/// Event `sentence-progress`: words given their sentences so far.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceProgress {
    /// The chapter whose words they are; none for the words of the recall.
    pub chapter_id: Option<String>,
    pub done: u32,
    pub total: u32,
}

/// A piece of a sentence from the book; the word being asked is `marked`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentencePart {
    pub text: String,
    pub marked: bool,
}

/// One word to answer in a sitting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeItem {
    pub word_id: String,
    pub direction: Direction,
    /// What is shown to translate: the English base form for `recognition`,
    /// the word's translations for `production`.
    pub prompt: String,
    /// What kind of word it is; none for a word no chapter labelled, or
    /// asked for in a conversation.
    pub part_of_speech: Option<PartOfSpeech>,
    /// The word's sentence, for a word that needs it to be told from
    /// another sense; any other word is asked on its own, and its sentence
    /// is the first hint ([`WordHint`]). For `production` its marked pieces
    /// have no text: they are the blank the answer goes in, and the English
    /// word is nowhere in the item.
    pub context: Option<Vec<SentencePart>>,
    /// The sentence of the word's bank it is asked with, to be sent back
    /// with the answer; none for a word asked as its chapter has it. With
    /// one, `prompt` is the word in the form that sentence has it: as
    /// written for `recognition`, translated for `production`.
    pub sentence_id: Option<String>,
    /// The form a verb has in that sentence; none for any other word, for
    /// one asked as its chapter has it, and until the sentence is labelled.
    pub verb_form: Option<VerbForm>,
}

/// The sentence a word was asked with, shown whole once it is answered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShownSentence {
    pub id: String,
    /// The sentence in English, the word in its place.
    pub text: String,
    /// The sentence in the learner's language.
    pub translation: String,
    /// From the book, not written by the model.
    pub book: bool,
}

/// A hint the learner asked for on the word they are shown: made by code,
/// never by the model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordHint {
    /// The answer with its first letters in place and a `_` for every
    /// other: how long it is, and how it starts. None on the first hint to
    /// a word whose sentence was kept back: the sentence is all it gives.
    pub mask: Option<String>,
    /// The sentence the word was asked without: the word marked, or taken
    /// out when it is the answer. It comes with every hint to that word.
    pub context: Option<Vec<SentencePart>>,
    /// Asking again gives more: the length, or one more letter.
    pub more: bool,
}

/// What an answer that is another English word for what was shown comes
/// back with: what tells the word asked for from it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnotherWord {
    /// The sentence the word was asked without, and its first letter.
    pub hint: WordHint,
    /// The hints that come before this one: the one asked for next comes
    /// after it, and gives one more letter.
    pub asked: u32,
}

/// How a sitting ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SittingSummary {
    /// Words finished during this sitting.
    pub done: u32,
    /// Words of the chapter neither finished nor known, asked or not.
    pub open: u32,
}

/// How far a sitting is, as the bar at its top shows it: `value` steps out
/// of `total`. Code counts them (`books::practice`); the screen only draws
/// the share. A sitting with nothing to count has a `total` of none, and is
/// as far as it goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SittingProgress {
    pub value: u32,
    pub total: u32,
}

/// What a sitting shows next: a word, or its summary once it is over. Either
/// way it says how far the sitting is by then; on the summary, and only
/// there, `value` is `total`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PracticeStep {
    Item {
        item: PracticeItem,
        progress: SittingProgress,
    },
    Summary {
        summary: SittingSummary,
        progress: SittingProgress,
    },
}

/// A sitting just started, or the unfinished one gone on with.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sitting {
    pub id: String,
    pub step: PracticeStep,
}

/// One size a session can be started in, with about how long it takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSize {
    /// What to start the session with; none for every open word.
    pub size: Option<u32>,
    /// How many words that is.
    pub words: u32,
    /// The estimate, in minutes.
    pub minutes: u32,
}

/// What "Practice" on a chapter can do now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeOptions {
    /// A session was left unfinished: starting goes on with it, with the
    /// words it had, and no size is asked for.
    pub resume: bool,
    /// The sizes on offer, smallest first; the last one is every open word,
    /// and is the one to start with unless the learner picks another.
    pub sizes: Vec<SessionSize>,
    /// The sizes on offer for a session of one direction alone.
    pub one_way: OneWay,
    /// The ways a session would be an extra review in: none of the open
    /// words owes anything that way, so its sizes count every word of the
    /// chapter the learner has not said they know, done ones included.
    pub extra: Vec<Ways>,
}

/// The sizes a session of one direction is offered in, by direction: the
/// words that still owe something that way, or every word to review when
/// none does. A chapter with no word to ask has the one size of no words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneWay {
    pub recognition: Vec<SessionSize>,
    pub production: Vec<SessionSize>,
}

/// The verdict on one answer, and what comes after it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerResult {
    /// Names this answer, for "I was right" (`dispute_answer`).
    pub answer_id: i64,
    pub correct: bool,
    /// What was asked for: the word's accepted translations, the first one
    /// first; for `production` the forms that fill the blank of its
    /// sentence, or its English base form when it is asked without one.
    pub accepted: Vec<String>,
    pub step: PracticeStep,
    /// Nothing was kept: the answer is the word in a form that does not
    /// fill the blank, or another word for what was shown, and the learner
    /// has one more try at it.
    pub again: bool,
    /// That answer was another English word for what was shown: right for
    /// what the learner saw, and not the word asked for.
    pub another: Option<AnotherWord>,
    /// Right on that second try.
    pub helped: bool,
    /// The translation in the form the sentence has the word in, when the
    /// answer was right in its base form: it is pointed out.
    pub exact: Option<String>,
    /// The sentence the word was asked with, when it was asked with one.
    pub sentence: Option<ShownSentence>,
}

/// What came of "I was right" on a missed answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisputeResult {
    /// The miss is undone: the answer counts as correct, and is accepted
    /// from now on.
    pub upheld: bool,
    /// One line in the learner's language saying why.
    pub reason: String,
    /// What the answer's sitting shows next as things stand now. An upheld
    /// answer can finish its word, and a word that is finished is not asked.
    pub step: PracticeStep,
}

/// How a pass of the refresh before reading stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSummary {
    /// Words answered right in the pass: they stay done.
    pub solid: u32,
    /// Words missed in the pass that are back in the chapter's practice.
    pub reopened: u32,
}

/// What a refresh shows next: a done word, asked English → native, or its
/// summary once every done word has been asked. Either way it says how far
/// the pass is: the words it has asked, out of the ones it asks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RefreshStep {
    Item {
        item: PracticeItem,
        progress: SittingProgress,
    },
    Summary {
        summary: RefreshSummary,
        progress: SittingProgress,
    },
}

/// A refresh just started, or gone on with.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Refresh {
    pub id: String,
    pub step: RefreshStep,
}

/// The verdict on one answer of a refresh, and what comes after it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshAnswer {
    pub correct: bool,
    /// The word's accepted translations, the first one first.
    pub accepted: Vec<String>,
    pub step: RefreshStep,
}

/// Where the daily recall stands: what is due, and how strong the learned
/// words are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallState {
    /// Words due today.
    pub due: u32,
    /// Learned words by how strong they are: `fresh` ones are new.
    pub fresh: u32,
    pub settling: u32,
    pub firm: u32,
}

/// How a run of the recall ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallSummary {
    /// Words answered right in the run: each comes back later than before.
    pub right: u32,
    /// Words missed in it: each comes back sooner.
    pub missed: u32,
    /// Words still due today, for another run.
    pub left: u32,
}

/// What a run of the recall shows next: a learned word, or its summary. In
/// its item a word goes by its key, as `word_id`: it belongs to no chapter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RecallStep {
    Item {
        item: PracticeItem,
        progress: SittingProgress,
    },
    Summary {
        summary: RecallSummary,
        progress: SittingProgress,
    },
}

/// A run of the recall just started.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recall {
    pub id: String,
    pub step: RecallStep,
}

/// The verdict on one answer of the recall, and what comes after it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallAnswer {
    pub correct: bool,
    /// What was asked for, the first one first.
    pub accepted: Vec<String>,
    pub step: RecallStep,
    /// The word keeps slipping: the learner is offered a note of their own.
    pub stubborn: bool,
    /// The note they wrote for it before.
    pub note: Option<String>,
    /// Names this answer, for calling its sentence bad.
    pub answer_id: i64,
    /// As in `AnswerResult`.
    pub again: bool,
    pub another: Option<AnotherWord>,
    pub helped: bool,
    pub exact: Option<String>,
    pub sentence: Option<ShownSentence>,
}

/// A word a review found the learner did not know, to add to practice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewWord {
    /// Its base form in English.
    pub english: String,
    pub translations: Vec<String>,
    /// The chapter already asks it: there is nothing to add.
    pub in_practice: bool,
}

/// One thing a review marks in what the learner wrote.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewMark {
    /// The words that are wrong, as the learner wrote them.
    pub fragment: String,
    pub severity: Severity,
    /// What they should have been.
    pub better: String,
    /// Why, in the learner's language.
    pub why: String,
    pub word: Option<ReviewWord>,
}

/// A piece of a sentence the learner wrote; `mark` says which of the
/// review's marks it is, counted from 0, when it is one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPart {
    pub text: String,
    pub mark: Option<u32>,
}

/// The review of a paragraph: what the learner wrote with its mistakes
/// marked, and what it scores out of 100 by its words and its mistakes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphReview {
    pub score: u32,
    /// One thing done well, in the learner's language.
    pub good: Option<String>,
    /// What the learner wrote, a sentence each, cut where the marks are.
    pub sentences: Vec<Vec<ReviewPart>>,
    /// In reading order.
    pub marks: Vec<ReviewMark>,
}

/// A mistake that came back in an attempt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repeated {
    pub habit: String,
    pub advice: String,
    /// Fragments the learner wrote that show it.
    pub examples: Vec<String>,
}

/// What matters most of a finished attempt, read before its paragraphs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummary {
    pub points: Vec<String>,
    pub habits: Vec<Repeated>,
}

/// One paragraph of a chapter being translated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationParagraph {
    /// Its place in the chapter, counted from 0.
    pub index: u32,
    /// The sentences to translate, in order. None for a paragraph whose
    /// version in the learner's language is not written yet
    /// (`prepare_paragraph`).
    pub source: Option<Vec<String>>,
    /// What the learner wrote, a sentence each, from the first on.
    pub written: Vec<String>,
    /// None until the paragraph is whole and reviewed (`review_paragraph`).
    pub review: Option<ParagraphReview>,
    /// The author's sentences: what the paragraph says in English.
    pub english: Vec<String>,
    /// The same sentences in pieces, the words the learner has learned
    /// marked: they are met again where the book uses them.
    pub learned: Vec<Vec<SentencePart>>,
}

/// One attempt at translating a chapter in one direction, as it stands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Translation {
    pub attempt_id: String,
    pub chapter_id: String,
    pub direction: TranslationDirection,
    /// It was finished: it is read, and nothing more is written in it.
    pub finished: bool,
    /// What its reviewed paragraphs score together; None before any is.
    pub score: Option<u32>,
    /// Written once it is finished and reviewed (`summarize_attempt`).
    pub summary: Option<AttemptSummary>,
    /// In reading order. Into the learner's language, every paragraph of
    /// the chapter; back into English, those already translated the other way.
    pub paragraphs: Vec<TranslationParagraph>,
    /// The `index` of the paragraph being translated; None when none is left.
    pub current: Option<u32>,
    /// How many paragraphs the chapter has.
    pub total: u32,
}

/// One attempt in the list of a chapter's attempts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationAttempt {
    pub id: String,
    pub direction: TranslationDirection,
    /// When it was started, RFC 3339.
    pub started_at: String,
    /// False while it is paused: it can be gone on with.
    pub finished: bool,
    /// The paragraphs it has whole, out of the ones open to it.
    pub done: u32,
    pub total: u32,
}

/// Every attempt at translating a chapter, the latest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationAttempts {
    pub attempts: Vec<TranslationAttempt>,
    /// How many paragraphs the chapter has.
    pub paragraphs: u32,
    /// How many of them are open back into English: an attempt has them
    /// whole in the learner's language.
    pub back: u32,
}

/// One structure of the catalogue, and how it stands for the learner. How
/// it is built and when it is used are worded by the interface, by its key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureInfo {
    pub key: String,
    pub level: Level,
    /// What grammars call it, in English.
    pub name: String,
    pub example: String,
    /// From the sessions on it alone: never "mastered".
    pub strength: Strength,
    /// It was practised, and it is time to practise it again.
    pub due: bool,
}

/// A structure a chapter uses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterStructure {
    pub key: String,
    /// Sentences that use it, in what was read of the chapter.
    pub count: u32,
    /// One of them; empty when none could be shown.
    pub example: String,
}

/// The structures of the chapter the learner is on, the most used first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterStructures {
    pub book_title: String,
    pub chapter: Chapter,
    /// The chapter was read for them; until then there are none.
    pub scanned: bool,
    pub structures: Vec<ChapterStructure>,
}

/// A session left before its end, to go on with.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureSittingInfo {
    pub id: String,
    pub started_at: String,
    pub done: u32,
    pub total: u32,
    /// The keys of its structures.
    pub structures: Vec<String>,
}

/// The menu of the structures: all of them, what was left unfinished, and
/// the chapter the learner is on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuresState {
    pub structures: Vec<StructureInfo>,
    pub paused: Vec<StructureSittingInfo>,
    /// The chapter opened last; none before any was.
    pub chapter: Option<ChapterStructures>,
}

/// What a sentence is asked to be about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Topic {
    /// One of `structures::TOPICS`, worded by the interface.
    Preset { key: String },
    /// One of the learner's interests, as they wrote it.
    Interest { label: String },
}

/// A word of the books a sentence is asked to use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureWord {
    /// Its base form.
    pub english: String,
    pub source: WordSource,
    /// None for a word nobody labelled.
    pub part_of_speech: Option<PartOfSpeech>,
    /// In the learner's language: what its chapter was prepared with.
    pub translations: Vec<String>,
}

/// One sentence to write.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureItem {
    pub index: u32,
    /// The key of its structure.
    pub structure: String,
    /// What grammars call the structure, in English.
    pub name: String,
    pub level: Level,
    /// A sentence that has it.
    pub example: String,
    /// What it is about; none when a word is asked for, which is then what
    /// the sentence is built on.
    pub topic: Option<Topic>,
    pub word: Option<StructureWord>,
    /// Part of the warm-up: the form of the structure is in sight.
    pub warm: bool,
}

/// What a sentence was worth, and why.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureResult {
    pub verdict: StructureVerdict,
    /// In the learner's language.
    pub explanation: String,
    /// A right sentence with the structure, close to the learner's.
    pub better: String,
    /// The word asked for is in the sentence; true when none was asked.
    pub used_word: bool,
}

/// How the sentences on one structure went in a session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureTally {
    pub key: String,
    /// Sentences not wrong.
    pub right: u32,
    pub total: u32,
}

/// How a session ended: its sentences by verdict, and by structure, the
/// weakest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureSummary {
    pub correct: u32,
    pub partial: u32,
    pub wrong: u32,
    pub structures: Vec<StructureTally>,
}

/// A session as it stands: the sentence to write next, or, once it is
/// finished, how it ended.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureSitting {
    pub id: String,
    /// How many sentences it was started with: a missed one adds to it.
    pub size: u32,
    /// The keys of its structures, in the order they first come.
    pub structures: Vec<String>,
    /// The chapter its words are from, when it is a session on one.
    pub chapter_id: Option<String>,
    pub done: u32,
    pub total: u32,
    pub item: Option<StructureItem>,
    pub summary: Option<StructureSummary>,
}

/// How the learner hears at one pace, over their latest sentences at it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaceStanding {
    pub pace: Pace,
    /// Words heard, out of `total`.
    pub right: u32,
    pub total: u32,
    pub sentences: u32,
    /// Enough of them were heard, over enough sentences: the pace is the
    /// learner's own.
    pub held: bool,
}

/// A word that escapes the learner's ear.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissedWord {
    pub word: String,
    pub times: u32,
}

/// The chapter the listening is on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningChapter {
    pub book_id: String,
    pub book_title: String,
    pub chapter: Chapter,
    /// How many sentences it is read in.
    pub sentences: u32,
    /// The sentence the reading was left at.
    pub place: u32,
}

/// A dictation left before its end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationInfo {
    pub id: String,
    pub done: u32,
    pub total: u32,
    pub started_at: String,
}

/// The listening menu: the pace understood, how each pace stands, what
/// escapes the ear, and the chapter to listen to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningState {
    /// The fastest pace understood; none before any is.
    pub understood: Option<Pace>,
    /// The pace a dictation is offered at.
    pub pace: Pace,
    /// Slowest first.
    pub standings: Vec<PaceStanding>,
    pub missed: Vec<MissedWord>,
    /// The words the next dictations keep sentences for.
    pub reinforced: Vec<String>,
    pub paused: Vec<DictationInfo>,
    /// The chapter asked for, or the one opened last; none without a book.
    pub chapter: Option<ListeningChapter>,
}

/// A chapter to listen to: its sentences by paragraph, each in pieces with
/// the words the learner has learned marked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterReading {
    pub book_id: String,
    pub book_title: String,
    pub chapter: Chapter,
    pub paragraphs: Vec<Vec<Vec<SentencePart>>>,
    /// The sentence the reading was left at, counted across paragraphs.
    pub place: u32,
}

/// Event `chapter-listening`: the sentence being read aloud.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterListening {
    pub chapter_id: String,
    pub sentence: u32,
}

/// The sentence a dictation is on. What it says is only heard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationItem {
    pub index: u32,
    /// How often it was listened to.
    pub listens: u32,
    /// The slowest pace it was heard at; none before it is.
    pub pace: Option<Pace>,
    /// It was missed earlier in the session and is back.
    pub retry: bool,
}

/// How a finished dictation went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationSummary {
    pub correct: u32,
    pub partial: u32,
    pub wrong: u32,
    /// Words heard, out of `total`.
    pub right: u32,
    pub total: u32,
    /// The pace most of it was answered at.
    pub pace: Pace,
    pub hint: Option<PaceHint>,
    /// The fastest pace understood, after it.
    pub understood: Option<Pace>,
}

/// A dictation as it stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dictation {
    pub id: String,
    pub chapter_id: Option<String>,
    /// The pace it was started at.
    pub pace: Pace,
    pub done: u32,
    pub total: u32,
    /// None once every sentence is answered.
    pub item: Option<DictationItem>,
    /// Only once it is finished.
    pub summary: Option<DictationSummary>,
}

/// One word of a dictated sentence, and whether it was typed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeardWord {
    pub text: String,
    pub heard: bool,
}

/// What an answer to a dictated sentence was worth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationResult {
    pub verdict: StructureVerdict,
    pub sentence: String,
    pub words: Vec<HeardWord>,
    pub listens: u32,
    /// It was slowed down after it had been heard.
    pub slowed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_use_the_typescript_spelling() {
        assert_eq!(Personality::CuriousFriend.as_str(), "curiousFriend");
        assert_eq!(
            ProviderMode::parse("claudeCode"),
            Some(ProviderMode::ClaudeCode)
        );
        assert_eq!(ErrorKind::WordOrder.as_str(), "wordOrder");
        assert_eq!(Cefr::parse("B2"), Some(Cefr::B2));
        assert_eq!(PatternState::parse("nope"), None);
    }

    #[test]
    fn report_cards_are_tagged_like_the_typescript_union() {
        let card = ReportCard::Challenge {
            text: "Use it twice".into(),
            previous_achieved: None,
        };
        let json = serde_json::to_value(&card).expect("serializes");
        assert_eq!(json["type"], "challenge");
        assert!(json.get("previousAchieved").is_some());
    }

    #[test]
    fn a_rewrite_stored_before_notes_existed_still_loads() {
        let card: ReportCard = serde_json::from_value(serde_json::json!({
            "type": "couldHaveSaid",
            "items": [],
            "nativeRewrite": {"original": "I go", "rewrite": "I went"}
        }))
        .expect("loads");
        let ReportCard::CouldHaveSaid {
            native_rewrite: Some(rewrite),
            ..
        } = card
        else {
            panic!("a rewrite");
        };
        assert_eq!(rewrite.notes, []);
    }
}
