/**
 * Types that cross the Tauri bridge (webview ⇄ Rust).
 *
 * Rust mirrors every one of these with `#[serde(rename_all = "camelCase")]`
 * in `src-tauri/src/domain.rs`. When the two disagree, Rust wins and this file
 * is fixed.
 */

export type Level = "basic" | "intermediate" | "advanced";
export type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type Goal = "work" | "travel" | "exams" | "social" | "other";
export type Variant = "us" | "uk";
export type UiLang = "en" | "es";
export type Mode =
  "casual" | "interview" | "debate" | "story" | "roleplay" | "material";
export type Personality =
  "curiousFriend" | "strictInterviewer" | "coworker" | "contrarian";
export type FocusMode = "free" | "pending";
export type ProviderMode = "apiKey" | "claudeCode";
export type PatternState =
  "detected" | "focus" | "improving" | "mastered" | "relapse";
export type ErrorKind =
  | "grammarRule"
  | "lexical"
  | "collocation"
  | "wordOrder"
  | "register"
  | "pronoun"
  | "other";
export type DrillFormat =
  "sameStructure" | "transformation" | "guidedChat" | "spotError";
export type Modality = "voice" | "text" | "mixed";

export interface Profile {
  name: string | null;
  /** BCP-47 primary tag of the learner's first language, e.g. `es`, `pt`. */
  nativeLang: string;
  uiLang: UiLang;
  goal: Goal;
  variant: Variant;
  interests: string[];
  level: Level;
  /** `HH:MM`, local time, or null for no reminder. */
  reminderTime: string | null;
  onboarded: boolean;
}

export interface ProfileFact {
  id: string;
  text: string;
}

export interface Settings {
  providerMode: ProviderMode;
  model: string;
  /** Absolute path of the user's own `claude` executable. */
  claudePath: string | null;
  sttModel: string | null;
}

export interface ProviderCheck {
  ok: boolean;
  message: string | null;
}

export interface SessionSetup {
  /** At most 200 characters. */
  topic: string;
  level: Level;
  mode: Mode;
  personality: Personality;
  focusMode: FocusMode;
  /** Minutes of speech, not of wall-clock time. Null means no target. */
  targetMinutes: number | null;
  /** Pasted text for `mode: "material"`. */
  material: string | null;
}

export interface Turn {
  id: string;
  role: "user" | "assistant";
  /** What was sent to the partner. */
  sentText: string;
  /** What the speech recogniser heard, before any edit. Null for typed turns. */
  saidText: string | null;
  speechSeconds: number | null;
  words: number;
}

export interface SessionStarted {
  sessionId: string;
  opening: Turn;
  /** A one-line hint under the question: "Try 2–3 sentences". */
  lengthHint: string;
  /** Word goal per turn for the live meter. */
  turnWordGoal: number;
  /** Starters and key words shown at basic level; empty otherwise. */
  scaffolds: string[];
}

export interface TurnReply {
  userTurn: Turn;
  reply: Turn;
  lengthHint: string;
  scaffolds: string[];
  /** Minutes of speech produced so far in this session. */
  speechMinutes: number;
  /** True the first time the session's target is reached. */
  targetReached: boolean;
}

/** Streamed while the partner writes. Event name: `chat-delta`. */
export interface ChatDelta {
  sessionId: string;
  text: string;
}

export interface HelpOption {
  english: string;
  note: string | null;
}

export interface PatternView {
  id: string;
  description: string;
  kind: ErrorKind;
  state: PatternState;
  /** Share of spontaneous uses that were correct, 0–1, or null with no data. */
  correctRate: number | null;
  sessionsSeen: number;
  nextReviewAt: string | null;
}

export interface Streak {
  days: number;
  /** Rest days still available this ISO week. */
  freezesLeft: number;
  practicedToday: boolean;
}

export interface HomeState {
  profile: Profile;
  lastSetup: SessionSetup | null;
  suggestedTopics: string[];
  focus: PatternView | null;
  dueReviews: number;
  streak: Streak;
  activeChallenge: string | null;
  /** Suggested when the same mode was used four sessions running. */
  rotationSuggestion: Mode | null;
  /** Suggested when three sessions in a row sat outside the chosen level. */
  levelSuggestion: Level | null;
}

export interface SessionMetrics {
  modality: Modality;
  speechMinutes: number;
  userWords: number;
  /** Learner's share of all words, 0–1. */
  userShare: number;
  wordsPerTurn: number;
  /** Measure of textual lexical diversity. */
  mtld: number | null;
  errorsPer100: number;
  globalErrorsPer100: number;
  clausesPerUnit: number | null;
  subordinationRatio: number | null;
}

export interface CorrectionCard {
  type: "correction";
  role: "focus" | "minor";
  itemId: string;
  patternId: string;
  /** The learner's exact words. */
  original: string;
  /** The span inside `original` that holds the error. */
  highlight: string;
  corrected: string;
  /** One or two lines, in the learner's language. */
  explanation: string;
  hint: string;
  /** Rule-based errors ask the learner to fix it first; lexical ones do not. */
  selfCorrect: boolean;
  /** "Appeared in 4 of your last 6 conversations", or null. */
  recurrence: string | null;
}

export interface Rewrite {
  original: string;
  better: string;
  /** In the learner's language. */
  why: string;
}

export interface NativeRewrite {
  original: string;
  rewrite: string;
}

export interface VocabItem {
  /** What the learner asked for in their language; null when the partner used it. */
  asked: string | null;
  english: string;
  note: string | null;
}

export type ReportCard =
  | {
      type: "achievement";
      strengths: string[];
      bestSentence: string | null;
      selfCorrections: string[];
    }
  | CorrectionCard
  | {
      type: "couldHaveSaid";
      items: Rewrite[];
      nativeRewrite: NativeRewrite | null;
    }
  | {
      type: "vocabulary";
      items: VocabItem[];
    }
  | {
      type: "metrics";
      current: SessionMetrics;
      /** Mean of the last five sessions with the same modality. */
      previous: SessionMetrics | null;
      estimatedCefr: Cefr | null;
    }
  | {
      type: "challenge";
      text: string;
      /** Whether the challenge set last time was met in this session. */
      previousAchieved: boolean | null;
    };

export interface Report {
  sessionId: string;
  cards: ReportCard[];
}

/** Progress of the end-of-session analysis. Event name: `analysis-progress`. */
export interface AnalysisProgress {
  sessionId: string;
  step: "analyzing" | "composing" | "done";
}

export interface SelfCheck {
  correct: boolean;
  hint: string | null;
}

export interface DrillItem {
  index: number;
  format: DrillFormat;
  patternId: string;
  /** In English. */
  prompt: string;
  /** In the learner's language. */
  instruction: string;
  /** For `spotError`: the sentences to choose from. */
  options: string[];
}

export interface Drill {
  id: string;
  items: DrillItem[];
}

export interface DrillResult {
  correct: boolean;
  explanation: string;
  expected: string;
  /** One replacement item after a miss, at most once per item. */
  retry: DrillItem | null;
}

export interface SessionSummary {
  id: string;
  startedAt: string;
  topic: string;
  mode: Mode;
  level: Level;
  speechMinutes: number;
  hasReport: boolean;
}

export interface WeekMinutes {
  /** ISO week, e.g. `2026-W39`. */
  week: string;
  minutes: number;
}

export interface CefrPoint {
  date: string;
  cefr: Cefr;
}

export interface DatedText {
  date: string;
  text: string;
}

export interface VocabEntry {
  asked: string | null;
  english: string;
  date: string;
}

export type TrendPoint = SessionMetrics & { date: string };

export interface Progress {
  patterns: PatternView[];
  weeklyMinutes: WeekMinutes[];
  cefrHistory: CefrPoint[];
  bestSentences: DatedText[];
  vocabulary: VocabEntry[];
  trend: TrendPoint[];
  sessions: SessionSummary[];
}

export interface SttModel {
  id: string;
  name: string;
  bytes: number;
  languages: string[];
  downloaded: boolean;
}

export interface SttStatus {
  /** False where the recogniser library is not shipped for this platform. */
  available: boolean;
  models: SttModel[];
  selected: string | null;
}

/** Event name: `stt-download`. */
export interface SttDownload {
  modelId: string;
  received: number;
  total: number;
}

/** Event name: `stt-level`. Microphone peak, 0–1, about ten times a second. */
export interface SttLevel {
  peak: number;
  speechSeconds: number;
}

/** Event name: `stt-partial`. Everything said so far, while the learner speaks. */
export interface SttPartial {
  text: string;
}

export interface Recording {
  text: string;
  audioId: string;
  speechSeconds: number;
}

/** The only error shape a command returns. */
export interface CommandError {
  kind:
    | "invalid"
    | "notFound"
    | "provider"
    | "database"
    | "io"
    | "stt"
    | "internal";
  message: string;
}
