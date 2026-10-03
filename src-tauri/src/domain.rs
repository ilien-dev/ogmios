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
// Which way a word is asked: English → native, or native → English.
wire_enum!(Direction { Recognition => "recognition", Production => "production" });
wire_enum!(Level { Basic => "basic", Intermediate => "intermediate", Advanced => "advanced" });
wire_enum!(Cefr { A1 => "A1", A2 => "A2", B1 => "B1", B2 => "B2", C1 => "C1", C2 => "C2" });
wire_enum!(Goal { Work => "work", Travel => "travel", Exams => "exams", Social => "social", Other => "other" });
wire_enum!(Variant { Us => "us", Uk => "uk" });
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
/// Rust.
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
    /// The base form: "run" for "ran".
    pub lemma: String,
    /// Accepted translations in the learner's language, the first one first.
    pub translations: Vec<String>,
    /// How often it occurs in the chapter.
    pub count: u32,
    /// Finished in both directions.
    pub done: bool,
    /// The learner said they know it already: it is not asked, here or in
    /// any other chapter, until they take that back.
    pub known: bool,
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
    /// The base form: "run" for "ran".
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
    /// The word's sentence from the book, for a word that needs it. For
    /// `production` its marked pieces have no text: they are the blank the
    /// answer goes in, and the English word is nowhere in the item.
    pub context: Option<Vec<SentencePart>>,
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
}

/// The verdict on one answer, and what comes after it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerResult {
    /// Names this answer, for "I was right" (`dispute_answer`).
    pub answer_id: i64,
    pub correct: bool,
    /// What was asked for: the word's accepted translations, the first one
    /// first, or for `production` its English base form.
    pub accepted: Vec<String>,
    pub step: PracticeStep,
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
