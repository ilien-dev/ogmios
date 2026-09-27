//! Typed mirror of `shared/protocol.ts`. On disagreement the TypeScript wins:
//! the sidecar validates with zod and rejects anything else.

use serde::{Deserialize, Serialize};

use crate::domain::{
    Cefr, DrillFormat, ErrorKind, Goal, HelpOption, Level, NativeRewrite, ProviderMode, Role,
    SessionSetup, Variant,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureParams {
    pub mode: ProviderMode,
    pub model: String,
    pub api_key: Option<String>,
    pub claude_path: Option<String>,
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
