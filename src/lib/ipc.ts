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
  PracticeItem,
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
  Ways,
  WordHint,
  PracticeStep,
  Recall,
  RecallAnswer,
  RecallState,
  RecallStep,
  Refresh,
  RefreshAnswer,
  SentenceProgress,
  Sitting,
  SttDownload,
  SttLevel,
  SttPartial,
  SttStatus,
  Translation,
  TranslationAttempts,
  TranslationDirection,
  TtsDownload,
  TtsStatus,
  TurnReply,
  UpdateInfo,
} from "@shared/domain";
import type {
  ChapterListening,
  ChapterReading,
  Dictation,
  DictationResult,
  ListeningState,
  Pace,
} from "@shared/listening";
import type {
  ChapterStructures,
  StructureResult,
  StructureSitting,
  StructuresState,
} from "@shared/structures";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { mock, mockListen } from "./ipcMock";

type Unlisten = () => void;

/** Every event the backend emits, by name. */
interface Events {
  "chat-delta": ChatDelta;
  "analysis-progress": AnalysisProgress;
  "chapter-progress": ChapterProgress;
  "chapter-listening": ChapterListening;
  "structure-scan-progress": ChapterProgress;
  "sentence-progress": SentenceProgress;
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
/**
 * Keeps that a word was left to learn while sorting its chapter's list, or
 * takes that back: the next sorting starts after the words that have it.
 * Resolves to the word's chapter as it stands after it.
 */
export const setWordSorted = (
  wordId: string,
  sorted: boolean,
): Promise<ChapterWords> => call("set_word_sorted", { wordId, sorted });
/** Has a chapter's list to be sorted again from its first word. */
export const restartSorting = (id: string): Promise<ChapterWords> =>
  call("restart_sorting", { id });
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
 * Starts a session on a prepared chapter with `size` of its open words,
 * drawn among them, or with all of them for null, asked in `ways`: its first
 * word, or its summary when nothing is left to ask. A session left halfway
 * needs no goodbye: every answer is kept as it is given, and while it is
 * unfinished this goes on with it, with the words and the ways it had,
 * whatever is asked for.
 */
export const startSitting = (
  chapterId: string,
  size: number | null,
  ways: Ways,
): Promise<Sitting> => call("start_sitting", { chapterId, size, ways });
/** The word an answer is given to, and the sentence it was asked with. */
type Asked = Pick<PracticeItem, "wordId" | "direction" | "sentenceId">;

/**
 * Checks one answer at once and says what the sitting shows next. An empty
 * answer is "I don't know": a miss, answered with what was asked for.
 */
export const answerWord = (
  sittingId: string,
  item: Asked,
  answer: string,
  second = false,
  hinted = false,
): Promise<AnswerResult> =>
  call("answer_word", {
    sittingId,
    wordId: item.wordId,
    direction: item.direction,
    answer,
    sentenceId: item.sentenceId,
    tries: { second, hinted },
  });
/**
 * A hint on the word a sitting is showing, once `asked` others were given:
 * the sentence the word was asked without, then how long its answer is,
 * then one more of its letters each time. Made by code: Claude is not
 * asked. The answer that follows says it was `hinted`, and a right one is
 * then a helped one.
 */
export const hintWord = (
  sittingId: string,
  item: Asked,
  asked: number,
): Promise<WordHint> =>
  call("hint_word", {
    sittingId,
    wordId: item.wordId,
    direction: item.direction,
    sentenceId: item.sentenceId,
    asked,
  });
/**
 * "This sentence is bad" on the answer just given: the sentence is never
 * asked with again and the answer is taken back, a miss or not.
 */
export const discardSentence = (answerId: number): Promise<PracticeStep> =>
  call("discard_sentence", { answerId });
/**
 * Says what kind of word each stored word without one is, of every book:
 * the ones prepared before words were labelled. How many got one. It runs
 * in the background and asks the model.
 */
export const labelWords = (): Promise<number> => call("label_words");
/**
 * Gives the words of a chapter, or with null the learned words of the
 * recall, the sentences of their book they do not have yet: Claude says
 * what the word is in each, and writes none. It runs in the background,
 * reporting `sentence-progress`.
 */
export const writeSentences = (chapterId: string | null): Promise<number> =>
  call("write_sentences", { chapterId });
export const onSentenceProgress = (
  h: (p: SentenceProgress) => void,
): Promise<Unlisten> => on("sentence-progress", h);
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

// ── The daily recall ──────────────────────────────────────────────────────

/** What is due today, and how strong the learned words are. */
export const recallState = (): Promise<RecallState> => call("recall_state");
/**
 * Starts a run of the recall in these ways: at most ten of the learned words
 * that are due, of any book or conversation, each asked once.
 */
export const startRecall = (ways: Ways): Promise<Recall> =>
  call("start_recall", { ways });
/**
 * Checks one answer of a run. A right one sends the word further away; a
 * miss, or an empty answer ("I don't know"), brings it back sooner. It never
 * reopens the word in its chapter. The word goes by its key.
 */
export const answerRecall = (
  sittingId: string,
  item: Asked,
  answer: string,
  second = false,
  hinted = false,
): Promise<RecallAnswer> =>
  call("answer_recall", {
    sittingId,
    wordId: item.wordId,
    answer,
    sentenceId: item.sentenceId,
    tries: { second, hinted },
  });
/** A hint on the word a run of the recall is showing: see `hintWord`. */
export const hintRecall = (
  sittingId: string,
  item: Asked,
  asked: number,
): Promise<WordHint> =>
  call("hint_recall", {
    sittingId,
    wordId: item.wordId,
    sentenceId: item.sentenceId,
    asked,
  });
/** "This sentence is bad" on the answer just given in a run of the recall. */
export const discardRecallSentence = (
  sittingId: string,
  answerId: number,
): Promise<RecallStep> =>
  call("discard_recall_sentence", { sittingId, answerId });
/** Keeps the learner's own note on a word; an empty one takes it away. */
export const saveWordNote = (wordId: string, note: string): Promise<void> =>
  call("save_word_note", { wordId, note });

// ── Translating a chapter ─────────────────────────────────────────────────

// ── Structures ────────────────────────────────────────────────────────────

/** Every structure, the sessions left unfinished, and the chapter one is on. */
export const structuresState = (): Promise<StructuresState> =>
  call("structures_state");

/**
 * Reads the chapter for its structures, once, reporting
 * `structure-scan-progress` on the way; it asks the model.
 */
export const scanChapterStructures = (
  chapterId: string,
): Promise<ChapterStructures> => call("scan_chapter_structures", { chapterId });

export const onStructureScan = (
  h: (p: ChapterProgress) => void,
): Promise<Unlisten> => on("structure-scan-progress", h);

/** Starts a session; on a chapter, with that chapter's words. */
export const startStructureSitting = (
  structures: readonly string[],
  size: number,
  chapterId: string | null,
): Promise<StructureSitting> =>
  call("start_structure_sitting", { structures, size, chapterId });

export const getStructureSitting = (
  sittingId: string,
): Promise<StructureSitting> => call("get_structure_sitting", { sittingId });

/** The word asked for at `index` will not fit: it is asked without it. */
export const dropStructureWord = (
  sittingId: string,
  index: number,
): Promise<StructureSitting> =>
  call("drop_structure_word", { sittingId, index });

/** Judges the sentence written for the one at `index`; it asks the model. */
export const answerStructure = (
  sittingId: string,
  index: number,
  answer: string,
  peeked: boolean,
): Promise<StructureResult> =>
  call("answer_structure", { sittingId, index, answer, peeked });

/** Leaves a session: paused, or finished as it is. */
export const closeStructureSitting = (
  sittingId: string,
  finished: boolean,
): Promise<void> => call("close_structure_sitting", { sittingId, finished });

// ── Listening ─────────────────────────────────────────────────────────────

/**
 * The pace understood, how each pace stands, and the chapter to listen to:
 * the one given, or the one opened last.
 */
export const listeningState = (
  chapterId: string | null = null,
): Promise<ListeningState> => call("listening_state", { chapterId });

/** A chapter by its sentences, and where its reading aloud was left. */
export const chapterReading = (chapterId: string): Promise<ChapterReading> =>
  call("chapter_reading", { chapterId });

/**
 * Reads a chapter aloud from a sentence on, reporting `chapter-listening`
 * as each one starts. Resolves to whether it was heard to its end; `ttsStop`
 * or anything else read aloud ends it before.
 */
export const listenChapter = (
  chapterId: string,
  from: number,
  pace: Pace,
): Promise<boolean> => call("listen_chapter", { chapterId, from, pace });

export const onChapterListening = (
  h: (heard: ChapterListening) => void,
): Promise<Unlisten> => on("chapter-listening", h);

/** Starts a dictation of sentences of a chapter, at a pace. */
export const startDictation = (
  chapterId: string,
  pace: Pace,
): Promise<Dictation> => call("start_dictation", { chapterId, pace });

export const getDictation = (sittingId: string): Promise<Dictation> =>
  call("get_dictation", { sittingId });

/**
 * Plays the sentence a dictation is on, and counts the listen. Resolves
 * once it has been heard, or was silenced.
 */
export const hearDictation = (
  sittingId: string,
  index: number,
  pace: Pace,
): Promise<Dictation> => call("hear_dictation", { sittingId, index, pace });

/** Compares what was typed with the sentence; `pace` counts if unheard. */
export const answerDictation = (
  sittingId: string,
  index: number,
  answer: string,
  pace: Pace,
): Promise<DictationResult> =>
  call("answer_dictation", { sittingId, index, answer, pace });

/** Leaves a dictation: paused, or finished as it is. */
export const closeDictation = (
  sittingId: string,
  finished: boolean,
): Promise<void> => call("close_dictation", { sittingId, finished });

/** Every attempt at translating a chapter, the latest first. */
export const listAttempts = (chapterId: string): Promise<TranslationAttempts> =>
  call("list_attempts", { chapterId });
/**
 * Starts an attempt from the first paragraph. Back into English it is
 * refused until a paragraph is whole in the learner's language.
 */
export const startAttempt = (
  chapterId: string,
  direction: TranslationDirection,
): Promise<Translation> => call("start_attempt", { chapterId, direction });
/** An attempt as it stands: to go on with it, or to read it once finished. */
export const getAttempt = (attemptId: string): Promise<Translation> =>
  call("get_attempt", { attemptId });
/**
 * Leaves an attempt: paused, to go on with later, or finished for good. One
 * with nothing written is not kept either way.
 */
export const closeAttempt = (
  attemptId: string,
  finished: boolean,
): Promise<void> => call("close_attempt", { attemptId, finished });
/**
 * Deletes an attempt for good, paused or finished, with what was written in
 * it, its reviews and its summary.
 */
export const deleteAttempt = (attemptId: string): Promise<void> =>
  call("delete_attempt", { attemptId });
/**
 * Keeps one sentence of the paragraph being translated: the next one, or one
 * already written. No sentence is skipped, and a paragraph that is whole is
 * not touched again.
 */
export const writeSentence = (
  attemptId: string,
  paragraph: number,
  sentence: number,
  text: string,
): Promise<Translation> =>
  call("write_sentence", { attemptId, paragraph, sentence, text });
/**
 * Writes the version of a paragraph that is translated back into English, if
 * it has none yet: Claude takes seconds. The paragraph has to be whole the
 * other way. The attempt as it stands after it.
 */
export const prepareParagraph = (
  attemptId: string,
  paragraph: number,
): Promise<Translation> => call("prepare_paragraph", { attemptId, paragraph });
/**
 * Reviews a paragraph that is whole, if it has no review yet: Claude takes
 * seconds, and the learner goes on meanwhile. A failed request keeps nothing.
 */
export const reviewParagraph = (
  attemptId: string,
  paragraph: number,
): Promise<Translation> => call("review_paragraph", { attemptId, paragraph });

/**
 * Sums a finished attempt up from the notes of its reviews, if it has no
 * summary yet: Claude takes seconds.
 */
export const summarizeAttempt = (attemptId: string): Promise<Translation> =>
  call("summarize_attempt", { attemptId });
/**
 * Adds the word a mark of a review is about to the practice of the
 * attempt's chapter. One the chapter already asks is left as it is.
 */
export const practiseWord = (
  attemptId: string,
  paragraph: number,
  mark: number,
): Promise<Translation> =>
  call("practise_word", { attemptId, paragraph, mark });

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
