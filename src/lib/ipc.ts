/**
 * The only file that calls `invoke()` or `listen()`. One function per
 * `#[tauri::command]` in `src-tauri/src/commands/`; argument names are the
 * camelCase of the Rust parameter names.
 *
 * Outside Tauri (plain `bun run dev`, tests) every call goes to `ipcMock.ts`.
 */
import type {
  AnalysisProgress,
  AnswerResult,
  Book,
  Chapter,
  ChapterProgress,
  ChapterWords,
  ChatDelta,
  Depth,
  Direction,
  DisputeResult,
  Drill,
  DrillFormat,
  DrillResult,
  HelpOption,
  HomeState,
  KnownWord,
  ModelOption,
  Profile,
  ProfileFact,
  Progress,
  ProviderCheck,
  Recording,
  Report,
  SelfCheck,
  SessionSetup,
  SessionStarted,
  Settings,
  PracticeOptions,
  PracticeStep,
  Refresh,
  RefreshAnswer,
  Sitting,
  SttDownload,
  SttLevel,
  SttPartial,
  SttStatus,
  TtsDownload,
  TtsStatus,
  TurnReply,
  UpdateInfo,
} from "@shared/domain";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { mock, mockListen } from "./ipcMock";

type Unlisten = () => void;

/** Every event the backend emits, by name. */
interface Events {
  "chat-delta": ChatDelta;
  "analysis-progress": AnalysisProgress;
  "chapter-progress": ChapterProgress;
  "stt-level": SttLevel;
  "stt-partial": SttPartial;
  "stt-download": SttDownload;
  "tts-download": TtsDownload;
}

function inTauri(): boolean {
  return "__TAURI_INTERNALS__" in globalThis;
}

async function call<T>(command: string, args: InvokeArgs = {}): Promise<T> {
  if (!inTauri()) {
    return mock<T>(command, args);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function on<K extends keyof Events>(
  event: K,
  handler: (payload: Events[K]) => void,
): Promise<Unlisten> {
  if (!inTauri()) {
    return mockListen(event, handler);
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<Events[K]>(event, (e) => {
    handler(e.payload);
  });
}

// ── Profile and settings ──────────────────────────────────────────────────

export const getProfile = (): Promise<Profile | null> => call("get_profile");
export const saveProfile = (profile: Profile): Promise<void> =>
  call("save_profile", { profile });
export const listProfileFacts = (): Promise<ProfileFact[]> =>
  call("list_profile_facts");
export const deleteProfileFact = (id: string): Promise<void> =>
  call("delete_profile_fact", { id });

export const getSettings = (): Promise<Settings> => call("get_settings");
export const saveSettings = (settings: Settings): Promise<void> =>
  call("save_settings", { settings });
export const setApiKey = (key: string | null): Promise<void> =>
  call("set_api_key", { key });
export const hasApiKey = (): Promise<boolean> => call("has_api_key");
export const detectClaude = (): Promise<string | null> => call("detect_claude");
export const listModels = (): Promise<ModelOption[]> => call("list_models");
export const checkProvider = (): Promise<ProviderCheck> =>
  call("check_provider");

// ── Home and sessions ─────────────────────────────────────────────────────

export const homeState = (): Promise<HomeState> => call("home_state");
export const startSession = (setup: SessionSetup): Promise<SessionStarted> =>
  call("start_session", { setup });
export const sendTurn = (
  sessionId: string,
  sentText: string,
  recording: Recording | null,
): Promise<TurnReply> => call("send_turn", { sessionId, sentText, recording });
export const helpTranslate = (
  sessionId: string,
  text: string,
): Promise<HelpOption[]> => call("help_translate", { sessionId, text });
export const endSession = (sessionId: string): Promise<Report> =>
  call("end_session", { sessionId });
export const getReport = (sessionId: string): Promise<Report | null> =>
  call("get_report", { sessionId });
export const selfCheck = (
  itemId: string,
  attempt: string,
): Promise<SelfCheck> => call("self_check", { itemId, attempt });
export const disputeItem = (itemId: string): Promise<void> =>
  call("dispute_item", { itemId });
export const deleteSessionAudio = (sessionId: string | null): Promise<void> =>
  call("delete_session_audio", { sessionId });
/** The conversation goes, and with it what it added to the progress. */
export const deleteSession = (sessionId: string): Promise<void> =>
  call("delete_session", { sessionId });

export const onChatDelta = (h: (d: ChatDelta) => void): Promise<Unlisten> =>
  on("chat-delta", h);
export const onAnalysisProgress = (
  h: (p: AnalysisProgress) => void,
): Promise<Unlisten> => on("analysis-progress", h);

// ── Drills ────────────────────────────────────────────────────────────────

/** `patternId` null means "whatever is due". */
export const startDrill = (
  patternId: string | null,
  format: DrillFormat | null,
): Promise<Drill> => call("start_drill", { patternId, format });
export const answerDrill = (
  drillId: string,
  index: number,
  response: string,
): Promise<DrillResult> => call("answer_drill", { drillId, index, response });

// ── Books ─────────────────────────────────────────────────────────────────

export const listBooks = (): Promise<Book[]> => call("list_books");
/**
 * Opens the native file dialog. Resolves to the chosen path, which only Rust
 * reads, or null when the learner cancels. `label` names the file type.
 */
export async function pickBookFile(label: string): Promise<string | null> {
  if (!inTauri()) {
    return mock<string | null>("pick_book_file", {});
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    multiple: false,
    directory: false,
    filters: [{ name: label, extensions: ["epub", "pdf"] }],
  });
}
/** The same file twice resolves to the book already there. */
export const importBook = (path: string): Promise<Book> =>
  call("import_book", { path });
export const deleteBook = (id: string): Promise<void> =>
  call("delete_book", { id });
/** An empty title gives the chapter back the name it has without one. */
export const renameChapter = (id: string, title: string): Promise<Chapter> =>
  call("rename_chapter", { id, title });
/** A chapter and the words it has so far: none before it is prepared. */
export const getChapterWords = (id: string): Promise<ChapterWords> =>
  call("get_chapter_words", { id });
/**
 * Takes the chapter's words at this depth, reporting `chapter-progress` on
 * the way. A depth already prepared answers at once; a deeper one adds words.
 */
export const prepareChapter = (
  id: string,
  depth: Depth,
): Promise<ChapterWords> => call("prepare_chapter", { id, depth });
/**
 * Marks a word as known already, or takes that back. Known, it is asked in no
 * chapter of any book and counts towards their readiness. Resolves to the
 * word's chapter as it stands after it.
 */
export const setWordKnown = (
  wordId: string,
  known: boolean,
): Promise<ChapterWords> => call("set_word_known", { wordId, known });
/** Every word marked as known, from any chapter of any book, latest first. */
export const listKnownWords = (): Promise<KnownWord[]> =>
  call("list_known_words");
/**
 * Takes a known word back by its key: it is asked again wherever a chapter
 * has it. Resolves to the words still known.
 */
export const forgetKnownWord = (key: string): Promise<KnownWord[]> =>
  call("forget_known_word", { key });
export const onChapterProgress = (
  h: (p: ChapterProgress) => void,
): Promise<Unlisten> => on("chapter-progress", h);
/**
 * What "Practice" on a prepared chapter can do now: go on with the session
 * left unfinished, or start one in a size on offer, each with its estimate.
 */
export const practiceOptions = (chapterId: string): Promise<PracticeOptions> =>
  call("practice_options", { chapterId });
/**
 * Starts a session on a prepared chapter with `size` of its open words, most
 * frequent first, or with all of them for null: its first word, or its
 * summary when nothing is left to ask. A session left halfway needs no
 * goodbye: every answer is kept as it is given, and while it is unfinished
 * this goes on with it, with the words it had, whatever the size.
 */
export const startSitting = (
  chapterId: string,
  size: number | null,
): Promise<Sitting> => call("start_sitting", { chapterId, size });
/**
 * Checks one answer at once and says what the sitting shows next. An empty
 * answer is "I don't know": a miss, answered with what was asked for.
 */
export const answerWord = (
  sittingId: string,
  item: { wordId: string; direction: Direction },
  answer: string,
): Promise<AnswerResult> =>
  call("answer_word", {
    sittingId,
    wordId: item.wordId,
    direction: item.direction,
    answer,
  });
/**
 * "I know this" on the word a sitting shows: the word is marked as known,
 * nothing is recorded as an answer, and the sitting says what comes next.
 */
export const knowWord = (
  sittingId: string,
  wordId: string,
): Promise<PracticeStep> => call("know_word", { sittingId, wordId });
/**
 * "I was right" on a missed answer: Claude says whether it is a right
 * translation. Upheld, the miss is undone and the answer accepted from then
 * on. It takes seconds and the sitting does not wait: `step` is what the
 * sitting shows next as things stand when the verdict arrives.
 */
export const disputeAnswer = (answerId: number): Promise<DisputeResult> =>
  call("dispute_answer", { answerId });
/**
 * What a running sitting shows next as things stand now. A verdict on an
 * answer of an earlier sitting carries that sitting's step, not this one's.
 */
export const sittingStep = (sittingId: string): Promise<PracticeStep> =>
  call("sitting_step", { sittingId });
/**
 * Starts the quick refresh of a chapter that is ready to read: one pass,
 * English → native, over its done words, each asked once. A pass left
 * halfway is gone on with; a finished one is not, and the next starts over.
 */
export const startRefresh = (chapterId: string): Promise<Refresh> =>
  call("start_refresh", { chapterId });
/**
 * Checks one answer of a refresh. A right one changes nothing; a miss, or an
 * empty answer for "I don't know", puts the word back in practice.
 */
export const answerRefresh = (
  sittingId: string,
  wordId: string,
  answer: string,
): Promise<RefreshAnswer> =>
  call("answer_refresh", { sittingId, wordId, answer });

// ── Progress ──────────────────────────────────────────────────────────────

export const getProgress = (): Promise<Progress> => call("get_progress");

// ── Speech to text ────────────────────────────────────────────────────────

export const sttStatus = (): Promise<SttStatus> => call("stt_status");
export const sttDownload = (modelId: string): Promise<void> =>
  call("stt_download", { modelId });
export const sttSelect = (modelId: string): Promise<void> =>
  call("stt_select", { modelId });
export const sttStart = (): Promise<void> => call("stt_start");
export const sttStop = (): Promise<Recording> => call("stt_stop");
export const sttCancel = (): Promise<void> => call("stt_cancel");

export const onSttLevel = (h: (l: SttLevel) => void): Promise<Unlisten> =>
  on("stt-level", h);
export const onSttPartial = (h: (p: SttPartial) => void): Promise<Unlisten> =>
  on("stt-partial", h);
export const onSttDownload = (h: (d: SttDownload) => void): Promise<Unlisten> =>
  on("stt-download", h);

// ── Text to speech ────────────────────────────────────────────────────────

export const ttsStatus = (): Promise<TtsStatus> => call("tts_status");
/** Resolves once the voice is on disk; reports `tts-download` on the way. */
export const ttsDownload = (): Promise<void> => call("tts_download");
/** Picks the voice and whether anything is read aloud by itself. */
export const ttsConfigure = (
  voice: string,
  enabled: boolean,
): Promise<TtsStatus> => call("tts_configure", { voice, enabled });
/**
 * Reads English aloud. Resolves when it has been heard to the end, or when
 * something else was said over it or `ttsStop` silenced it.
 */
export const ttsSpeak = (text: string): Promise<void> =>
  call("tts_speak", { text });
export const ttsStop = (): Promise<void> => call("tts_stop");
export const onTtsDownload = (h: (d: TtsDownload) => void): Promise<Unlisten> =>
  on("tts-download", h);

// ── App updates ───────────────────────────────────────────────────────────

export const appVersion = (): Promise<string> => call("app_version");
/** The newer release, or null when this one is the latest. */
export const checkUpdate = (): Promise<UpdateInfo | null> =>
  call("check_update");
/** Installs the newer release and restarts into it. */
export const installUpdate = (): Promise<void> => call("install_update");
