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
/** How hard the model thinks before it answers. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
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
  /** Null lets Ogmios pick per call: fast chat, a little more for analysis. */
  effort: Effort | null;
  /** Absolute path of the user's own `claude` executable. */
  claudePath: string | null;
  sttModel: string | null;
}

/** A model the configured provider offers, as it describes it. */
export interface ModelOption {
  /** What is sent as `model`: an alias in Claude Code, an id with a key. */
  id: string;
  name: string;
  /** Claude Code describes its models; the API does not. */
  description: string | null;
  /** Empty when the model takes no effort setting. */
  efforts: Effort[];
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
  /** Picks up where the last conversation ended. */
  continuePrevious: boolean;
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
  /** Topic of the conversation a new one can continue, when there is one. */
  continueTopic: string | null;
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

/** One change between the learner's fragment and the fluent version. */
export interface RewriteNote {
  /** Exact span of the learner's fragment. */
  from: string;
  /** Exact span of the rewrite that replaced it. */
  to: string;
  /** In the learner's language. */
  why: string;
}

export interface NativeRewrite {
  original: string;
  rewrite: string;
  /** At most three; empty in reports saved before notes existed. */
  notes: RewriteNote[];
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
  /** What the item drills: its pattern's description; empty if unknown. */
  focus: string;
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

/** Someone the voice that reads English aloud can sound like. */
export interface TtsVoice {
  id: string;
  name: string;
  variant: Variant;
}

export interface TtsStatus {
  /** What the one model weighs, downloaded or not. */
  bytes: number;
  downloaded: boolean;
  voices: TtsVoice[];
  /** The voice in use: the learner's pick, or the first of their English. */
  voice: string;
  /** Off, nothing is read aloud until asked for. */
  enabled: boolean;
}

/** Event name: `tts-download`. */
export interface TtsDownload {
  received: number;
  total: number;
}

export interface Recording {
  text: string;
  audioId: string;
  speechSeconds: number;
}

/** A newer release than the one running. */
export interface UpdateInfo {
  version: string;
  notes: string | null;
}

/** An uploaded book and its chapters in reading order. */
export interface Book {
  id: string;
  title: string;
  author: string | null;
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  index: number;
  /**
   * Empty when the book gives this part no name and the learner has not
   * given it one: the interface then calls it by its place in the book.
   */
  title: string;
  words: number;
  /** The deepest depth its words were taken at; null before it is prepared. */
  prepared: Depth | null;
  /**
   * The share of its words that are done or known, as a percentage; null
   * before it is prepared. 100, and only 100, is ready to read.
   */
  readiness: number | null;
}

/** The readiness of a chapter that can be read: every word done or known. */
export const READY = 100;

/**
 * How much of a chapter's vocabulary to learn, judged against the learner's
 * level. From shallowest to deepest: hardest, relevant, most.
 */
export type Depth = "most" | "relevant" | "hardest";

/** One word of a prepared chapter. */
export interface BookWord {
  id: string;
  /** The base form: "run" for "ran". */
  lemma: string;
  /** Accepted translations in the learner's language, the first one first. */
  translations: string[];
  /** How often it occurs in the chapter. */
  count: number;
  /** Finished in both directions. */
  done: boolean;
  /**
   * The learner said they know it already: it is not asked, here or in any
   * other chapter, until they take that back.
   */
  known: boolean;
}

/** A chapter and its words, most frequent first. */
export interface ChapterWords {
  chapter: Chapter;
  words: BookWord[];
}

/** A word the learner said they know already, whatever chapter it came from. */
export interface KnownWord {
  /** What the word is known by, in every chapter of every book. */
  key: string;
  /** The base form: "run" for "ran". */
  lemma: string;
  /** Its translations in a chapter that has it; none once its books are gone. */
  translations: string[];
}

/** Event `chapter-progress`: pieces of the chapter read so far. */
export interface ChapterProgress {
  chapterId: string;
  done: number;
  total: number;
}

/** Which way a word is asked: English → native, or native → English. */
export type Direction = "recognition" | "production";

/** A piece of a sentence from the book; the word being asked is `marked`. */
export interface SentencePart {
  text: string;
  marked: boolean;
}

/** One word to answer in a sitting. */
export interface PracticeItem {
  wordId: string;
  direction: Direction;
  /**
   * What is shown to translate: the English base form for `recognition`,
   * the word's translations for `production`.
   */
  prompt: string;
  /**
   * The word's sentence from the book, for a word that needs it. For
   * `production` its marked pieces have no text: they are the blank the
   * answer goes in, and the English word is nowhere in the item.
   */
  context: SentencePart[] | null;
}

/** How a sitting ended. */
export interface SittingSummary {
  /** Words finished during this sitting. */
  done: number;
  /** Words of the chapter neither finished nor known, asked or not. */
  open: number;
}

/**
 * How far a sitting is, as the bar at its top shows it: `value` steps out of
 * `total`. Rust counts them; the screen only draws the share. A sitting with
 * nothing to count has a `total` of none, and is as far as it goes.
 */
export interface SittingProgress {
  value: number;
  total: number;
}

/**
 * What a sitting shows next: a word, or its summary once it is over. Either
 * way it says how far the sitting is by then; on the summary, and only
 * there, `value` is `total`.
 */
export type PracticeStep =
  | { type: "item"; item: PracticeItem; progress: SittingProgress }
  | { type: "summary"; summary: SittingSummary; progress: SittingProgress };

/** A sitting just started, or the unfinished one gone on with. */
export interface Sitting {
  id: string;
  step: PracticeStep;
}

/** One size a session can be started in, with about how long it takes. */
export interface SessionSize {
  /** What to start the session with; null for every open word. */
  size: number | null;
  /** How many words that is. */
  words: number;
  /** The estimate, in minutes. */
  minutes: number;
}

/** What "Practice" on a chapter can do now. */
export interface PracticeOptions {
  /**
   * A session was left unfinished: starting goes on with it, with the words
   * it had, and no size is asked for.
   */
  resume: boolean;
  /**
   * The sizes on offer, smallest first; the last one is every open word, and
   * is the one to start with unless the learner picks another.
   */
  sizes: SessionSize[];
}

/** The verdict on one answer, and what comes after it. */
export interface AnswerResult {
  /** Names this answer, for "I was right" (`dispute_answer`). */
  answerId: number;
  correct: boolean;
  /**
   * What was asked for: the word's accepted translations, the first one
   * first, or for `production` its English base form.
   */
  accepted: string[];
  step: PracticeStep;
}

/** What came of "I was right" on a missed answer. */
export interface DisputeResult {
  /**
   * The miss is undone: the answer counts as correct, and is accepted from
   * now on.
   */
  upheld: boolean;
  /** One line in the learner's language saying why. */
  reason: string;
  /**
   * What the answer's sitting shows next as things stand now. An upheld
   * answer can finish its word, and a word that is finished is not asked.
   */
  step: PracticeStep;
}

/** How a pass of the refresh before reading stands. */
export interface RefreshSummary {
  /** Words answered right in the pass: they stay done. */
  solid: number;
  /** Words missed in the pass that are back in the chapter's practice. */
  reopened: number;
}

/**
 * What a refresh shows next: a done word, asked English → native, or its
 * summary once every done word has been asked. Either way it says how far
 * the pass is: the words it has asked, out of the ones it asks.
 */
export type RefreshStep =
  | { type: "item"; item: PracticeItem; progress: SittingProgress }
  | { type: "summary"; summary: RefreshSummary; progress: SittingProgress };

/** A refresh just started, or gone on with. */
export interface Refresh {
  id: string;
  step: RefreshStep;
}

/** The verdict on one answer of a refresh, and what comes after it. */
export interface RefreshAnswer {
  correct: boolean;
  /** The word's accepted translations, the first one first. */
  accepted: string[];
  step: RefreshStep;
}

/**
 * Why `prepare_chapter` refuses a chapter: the `message` of its `invalid`
 * error is this, for the interface to word.
 */
export type ChapterRefusal = "notEnglish";

/**
 * Why `import_book` refuses a file: the `message` of its `invalid` error is
 * one of these, for the interface to word.
 */
export type BookRefusal = "drm" | "unreadable" | "scanned";

/** The only error shape a command returns. */
export interface CommandError {
  kind:
    | "invalid"
    | "notFound"
    | "provider"
    | "database"
    | "io"
    | "stt"
    | "update"
    | "internal";
  message: string;
}
