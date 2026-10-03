/**
 * The only file that calls `invoke()` or `listen()`. One function per
 * `#[tauri::command]` in `src-tauri/src/commands/`; argument names are the
 * camelCase of the Rust parameter names.
 *
 * Outside Tauri (plain `bun run dev`, tests) every call goes to `ipcMock.ts`.
 */
import type {
  AnalysisProgress,
  ChatDelta,
  Drill,
  DrillFormat,
  DrillResult,
  HelpOption,
  HomeState,
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
  SttDownload,
  SttLevel,
  SttPartial,
  SttStatus,
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
  "stt-level": SttLevel;
  "stt-partial": SttPartial;
  "stt-download": SttDownload;
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

// ── App updates ───────────────────────────────────────────────────────────

export const appVersion = (): Promise<string> => call("app_version");
/** The newer release, or null when this one is the latest. */
export const checkUpdate = (): Promise<UpdateInfo | null> =>
  call("check_update");
/** Installs the newer release and restarts into it. */
export const installUpdate = (): Promise<void> => call("install_update");
