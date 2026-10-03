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
pub struct NativeRewrite {
    pub original: String,
    pub rewrite: String,
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
}
