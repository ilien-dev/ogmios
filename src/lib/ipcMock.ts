/**
 * An in-memory stand-in for the Rust backend, used whenever the webview is
 * not inside Tauri: `bun run dev` in a browser, and the test suite.
 *
 * It answers every command in `ipc.ts` with believable data and emits the
 * same events the backend does — partner replies arrive as `chat-delta`
 * chunks, the microphone reports `stt-level` ten times a second and
 * `stt-partial` as the phrase it will hear unfolds word by word, model
 * downloads report `stt-download` — so the whole app can be walked end to end
 * without a backend.
 *
 * Profile and settings survive a reload through `localStorage`. Add
 * `?mock=fresh` to the URL to start over at onboarding, `?mock=ready` to
 * skip it with a book on the shelf (`ipcMockBooks.ts`), or `?mock=update` to
 * have a newer release on offer (`ipcMockUpdate.ts`).
 */
import type {
  AnalysisProgress,
  ChatDelta,
  Drill,
  DrillResult,
  HelpOption,
  HomeState,
  ModelOption,
  Profile,
  ProviderCheck,
  Recording,
  Report,
  SelfCheck,
  SessionSetup,
  SessionStarted,
  Settings,
  SttLevel,
  SttModel,
  SttPartial,
  SttStatus,
  Turn,
  TurnReply,
} from "@shared/domain";
import type { Lang } from "./ipcMockData";
import {
  API_MODELS,
  CLAUDE_CODE_MODELS,
  CORRECTION_ANSWERS,
  FACTS,
  HEARD_PHRASES,
  HELP_OPTIONS,
  LENGTH_HINTS,
  OPENINGS,
  PATTERNS,
  REPLIES,
  scaffoldsFor,
  STT_MODELS,
  READY_SETUP,
  suggestedTopics,
  WORD_GOALS,
  pick,
  progress,
  reportCards,
} from "./ipcMockData";
import type { SeededItem } from "./ipcMockDrills";
import { drillItems, retryItem } from "./ipcMockDrills";
import {
  extraCommands,
  resetMockDeleted,
  shownProgress,
} from "./ipcMockExtras";

type Handler = (payload: never) => void;

/** Words per minute of writing that count as one minute of speech (§6.4). */
const TEXT_WORDS_PER_MINUTE = 100;
const STORAGE_KEY = "ogmios.mock";

interface MockSession {
  setup: SessionSetup;
  turns: Turn[];
  speechSeconds: number;
  targetReached: boolean;
}

interface MockDrill {
  items: SeededItem[];
  retried: Set<number>;
  nextIndex: number;
}

interface MockState {
  profile: Profile | null;
  settings: Settings;
  apiKey: string | null;
  facts: Array<{ id: string; text: string }>;
  lastSetup: SessionSetup | null;
  sessions: Map<string, MockSession>;
  reports: Map<string, Report>;
  drills: Map<string, MockDrill>;
  models: SttModel[];
  selectedModel: string | null;
  recordingTimer: ReturnType<typeof setInterval> | null;
  recordingSeconds: number;
  heardCount: number;
  counter: number;
}

class MockCommandError extends Error {
  readonly kind: "invalid" | "notFound" | "provider" | "stt";

  constructor(kind: MockCommandError["kind"], message: string) {
    super(message);
    this.name = "MockCommandError";
    this.kind = kind;
  }
}

const listeners: Map<string, Set<Handler>> = new Map();
let latencyScale = 1;
let state = freshState();

function freshState(): MockState {
  return {
    profile: null,
    settings: {
      providerMode: "apiKey",
      model: "claude-sonnet-5-5",
      effort: null,
      claudePath: null,
      sttModel: null,
    },
    apiKey: null,
    facts: FACTS.map((text, i) => ({ id: `fact-${i}`, text })),
    lastSetup: null,
    sessions: new Map(),
    reports: new Map(),
    drills: new Map(),
    models: STT_MODELS.map((model) => ({ ...model })),
    selectedModel: null,
    recordingTimer: null,
    recordingSeconds: 0,
    heardCount: 0,
    counter: 0,
  };
}

export function readyProfile(): Profile {
  return {
    name: "Lucía",
    nativeLang: "es",
    uiLang: "en",
    goal: "work",
    variant: "uk",
    interests: ["Travel", "Cooking", "Business"],
    level: "intermediate",
    reminderTime: "19:30",
    onboarded: true,
  };
}

/** Back to a first launch. `onboarded` skips straight to a set-up learner. */
export function resetMock(onboarded = false): void {
  if (state.recordingTimer !== null) {
    clearInterval(state.recordingTimer);
  }
  state = freshState();
  resetMockDeleted();
  if (onboarded) {
    const [voice] = state.models;
    if (voice !== undefined) {
      voice.downloaded = true;
      state.selectedModel = voice.id;
      state.settings.sttModel = voice.id;
    }
    state.profile = readyProfile();
    state.apiKey = "sk-ant-demo";
    state.lastSetup = READY_SETUP;
  }
}

/** Multiplies every simulated delay. The tests set it to zero. */
export function setMockLatency(scale: number): void {
  latencyScale = scale;
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms * latencyScale);
  });
}

function emit(event: string, payload: unknown): void {
  for (const handler of listeners.get(event) ?? []) {
    (handler as (value: unknown) => void)(payload);
  }
}

export function mockListen(
  event: string,
  handler: Handler,
): Promise<() => void> {
  const set: Set<Handler> = listeners.get(event) ?? new Set();
  set.add(handler);
  listeners.set(event, set);
  return Promise.resolve(() => {
    set.delete(handler);
  });
}

function nextId(prefix: string): string {
  state.counter += 1;
  return `${prefix}-${state.counter}`;
}

function lang(): Lang {
  return state.profile?.nativeLang === "es" ? "es" : "en";
}

function countWords(text: string): number {
  return text.split(/\s+/u).filter((word) => word !== "").length;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[’']/gu, "'")
    .replaceAll(/[^a-z' ]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/** One named argument of a command, as the caller sent it. */
function field(args: unknown, key: string): unknown {
  return (args as Record<string, unknown>)[key];
}

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile: state.profile,
        settings: state.settings,
        apiKey: state.apiKey,
        lastSetup: state.lastSetup,
      }),
    );
  } catch {
    // Storage is a convenience for the browser preview; without it the mock
    // simply starts fresh on the next load.
  }
}

function restore(): void {
  try {
    const mode = new URLSearchParams(globalThis.location.search).get("mock");
    if (mode === "fresh") {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (mode === "ready") {
      resetMock(true);
      return;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return;
    }
    const saved = JSON.parse(raw) as Partial<MockState>;
    state.profile = saved.profile ?? null;
    // Saved before effort existed, a stored copy may lack it.
    state.settings = { ...state.settings, effort: null, ...saved.settings };
    state.apiKey = saved.apiKey ?? null;
    state.lastSetup = saved.lastSetup ?? null;
    const model = state.models.find(
      (candidate) => candidate.id === state.settings.sttModel,
    );
    if (model !== undefined) {
      model.downloaded = true;
      state.selectedModel = model.id;
    }
  } catch {
    // A corrupt or unavailable store is the same as an empty one.
  }
}

async function streamText(sessionId: string, text: string): Promise<void> {
  const words = text.split(" ");
  for (const [i, word] of words.entries()) {
    await wait(35);
    emit("chat-delta", {
      sessionId,
      text: i === 0 ? word : ` ${word}`,
    } satisfies ChatDelta);
  }
}

function assistantTurn(text: string): Turn {
  return {
    id: nextId("turn"),
    role: "assistant",
    sentText: text,
    saidText: null,
    speechSeconds: null,
    words: countWords(text),
  };
}

function session(sessionId: string): MockSession {
  const found = state.sessions.get(sessionId);
  if (found === undefined) {
    throw new MockCommandError("notFound", `No session ${sessionId}`);
  }
  return found;
}

async function startSession(args: unknown): Promise<SessionStarted> {
  const setup = field(args, "setup") as SessionSetup;
  if (setup.topic.trim() === "" || setup.topic.length > 200) {
    throw new MockCommandError(
      "invalid",
      "The topic must be 1–200 characters.",
    );
  }
  state.lastSetup = { ...setup, continuePrevious: false };
  persist();
  const sessionId = nextId("s");
  const opening = assistantTurn(
    OPENINGS[setup.level].replace("{{topic}}", setup.topic.toLowerCase()),
  );
  state.sessions.set(sessionId, {
    setup,
    turns: [opening],
    speechSeconds: 0,
    targetReached: false,
  });
  await wait(400);
  await streamText(sessionId, opening.sentText);
  return {
    sessionId,
    opening,
    lengthHint: LENGTH_HINTS[setup.level],
    turnWordGoal: WORD_GOALS[setup.level],
    scaffolds: scaffoldsFor(setup.level, 0),
  };
}

async function sendTurn(args: unknown): Promise<TurnReply> {
  const sessionId = field(args, "sessionId") as string;
  const sentText = field(args, "sentText") as string;
  const recording = field(args, "recording") as Recording | null;
  const current = session(sessionId);
  const words = countWords(sentText);
  const speechSeconds =
    recording?.speechSeconds ?? (words / TEXT_WORDS_PER_MINUTE) * 60;
  const userTurn: Turn = {
    id: nextId("turn"),
    role: "user",
    sentText,
    saidText: recording?.text ?? null,
    speechSeconds,
    words,
  };
  current.turns.push(userTurn);
  current.speechSeconds += speechSeconds;
  const replied = ((current.turns.length - 2) / 2) % REPLIES.length;
  const replyText = REPLIES[replied] ?? "";
  await wait(500);
  await streamText(sessionId, replyText);
  const reply = assistantTurn(replyText);
  current.turns.push(reply);
  const speechMinutes = current.speechSeconds / 60;
  const target = current.setup.targetMinutes;
  const targetReached =
    !current.targetReached && target !== null && speechMinutes >= target;
  current.targetReached ||= targetReached;
  return {
    userTurn,
    reply,
    lengthHint: LENGTH_HINTS[current.setup.level],
    scaffolds: scaffoldsFor(current.setup.level, replied + 1),
    speechMinutes,
    targetReached,
  };
}

async function endSession(args: unknown): Promise<Report> {
  const sessionId = field(args, "sessionId") as string;
  session(sessionId);
  const steps: Array<AnalysisProgress["step"]> = [
    "analyzing",
    "composing",
    "done",
  ];
  for (const step of steps) {
    await wait(900);
    emit("analysis-progress", { sessionId, step } satisfies AnalysisProgress);
  }
  const report: Report = { sessionId, cards: reportCards(lang()) };
  state.reports.set(sessionId, report);
  return report;
}

async function selfCheck(args: unknown): Promise<SelfCheck> {
  const answer = CORRECTION_ANSWERS[field(args, "itemId") as string];
  const attempt = normalise(field(args, "attempt") as string);
  await wait(450);
  if (answer === undefined) {
    return { correct: false, hint: null };
  }
  const correct =
    attempt.includes(answer.fix) &&
    (answer.slip === null || !attempt.includes(answer.slip));
  return { correct, hint: correct ? null : answer.hint };
}

function sttModel(args: unknown): SttModel {
  const modelId = field(args, "modelId") as string;
  const model = state.models.find((candidate) => candidate.id === modelId);
  if (model === undefined) {
    throw new MockCommandError("notFound", `No model ${modelId}`);
  }
  return model;
}

async function sttDownload(args: unknown): Promise<void> {
  const model = sttModel(args);
  const modelId = model.id;
  const steps = 20;
  for (let step = 1; step <= steps; step += 1) {
    await wait(120);
    emit("stt-download", {
      modelId,
      received: Math.round((model.bytes * step) / steps),
      total: model.bytes,
    });
  }
  model.downloaded = true;
}

/** Like Rust: only a model already on disk can be picked. */
async function sttSelect(args: unknown): Promise<void> {
  const model = sttModel(args);
  if (!model.downloaded) {
    throw new MockCommandError("stt", `${model.name} is not downloaded yet`);
  }
  await after(60, () => {
    state.selectedModel = model.id;
    state.settings = { ...state.settings, sttModel: model.id };
    persist();
  });
}

function sttStart(): Promise<void> {
  if (state.recordingTimer !== null) {
    return Promise.reject(new MockCommandError("stt", "Already recording."));
  }
  state.recordingSeconds = 0;
  const words = (
    HEARD_PHRASES[state.heardCount % HEARD_PHRASES.length] ?? ""
  ).split(" ");
  let ticks = 0;
  state.recordingTimer = setInterval(() => {
    const talking = Math.random() > 0.2;
    if (talking) {
      state.recordingSeconds += 0.1;
    }
    emit("stt-level", {
      peak: talking ? 0.35 + Math.random() * 0.6 : Math.random() * 0.08,
      speechSeconds: state.recordingSeconds,
    } satisfies SttLevel);
    // A word about every 300 ms, like someone speaking at an easy pace.
    if (ticks % 3 === 0) {
      emit("stt-partial", {
        text: words.slice(0, ticks / 3 + 1).join(" "),
      } satisfies SttPartial);
    }
    ticks += 1;
  }, 100);
  return Promise.resolve();
}

async function sttStop(): Promise<Recording> {
  if (state.recordingTimer !== null) {
    clearInterval(state.recordingTimer);
    state.recordingTimer = null;
  }
  await wait(600);
  const text = HEARD_PHRASES[state.heardCount % HEARD_PHRASES.length] ?? "";
  state.heardCount += 1;
  return {
    text,
    audioId: nextId("audio"),
    speechSeconds: Math.max(state.recordingSeconds, countWords(text) / 2.2),
  };
}

function sttCancel(): Promise<void> {
  if (state.recordingTimer !== null) {
    clearInterval(state.recordingTimer);
    state.recordingTimer = null;
  }
  return Promise.resolve();
}

async function startDrill(args: unknown): Promise<Drill> {
  const format = field(args, "format") as
    Drill["items"][number]["format"] | null;
  await wait(700);
  const id = nextId("drill");
  const items = drillItems(format, lang());
  state.drills.set(id, { items, retried: new Set(), nextIndex: items.length });
  return { id, items: items.map((entry) => entry.item) };
}

async function answerDrill(args: unknown): Promise<DrillResult> {
  const drill = state.drills.get(field(args, "drillId") as string);
  const index = field(args, "index") as number;
  const entry = drill?.items.find(
    (candidate) => candidate.item.index === index,
  );
  if (drill === undefined || entry === undefined) {
    throw new MockCommandError("notFound", "No such drill item.");
  }
  await wait(500);
  const response = normalise(field(args, "response") as string);
  const { seed } = entry;
  const correct =
    seed.accept.some((accepted) => response.includes(normalise(accepted))) &&
    (seed.slip === null || !response.includes(seed.slip));
  let retry = null;
  if (!correct && !drill.retried.has(index)) {
    drill.retried.add(index);
    const replacement = retryItem(entry, drill.nextIndex, lang());
    drill.nextIndex += 1;
    drill.retried.add(replacement.item.index);
    drill.items.push(replacement);
    retry = replacement.item;
  }
  return {
    correct,
    explanation: pick(lang(), ...seed.explanation),
    expected: seed.expected,
    retry,
  };
}

function homeState(): HomeState {
  const profile = state.profile ?? readyProfile();
  return {
    profile,
    lastSetup: state.lastSetup,
    continueTopic: state.lastSetup?.topic ?? null,
    suggestedTopics: suggestedTopics(state.lastSetup?.topic),
    focus: PATTERNS[0] ?? null,
    dueReviews: 2,
    streak: { days: 4, freezesLeft: 2, practicedToday: false },
    activeChallenge: pick(
      lang(),
      "Usa dos veces el present perfect para hablar de experiencias.",
      "Use the present perfect twice to talk about experiences.",
    ),
    rotationSuggestion: state.lastSetup?.mode === "casual" ? "debate" : null,
    levelSuggestion: null,
  };
}

function listModels(): ModelOption[] {
  const viaClaude = state.settings.providerMode === "claudeCode";
  if (viaClaude ? state.settings.claudePath === null : state.apiKey === null) {
    throw new MockCommandError("provider", "Not connected yet.");
  }
  return (viaClaude ? CLAUDE_CODE_MODELS : API_MODELS).map((m) => ({ ...m }));
}

function checkProvider(): ProviderCheck {
  if (state.settings.providerMode === "claudeCode") {
    return state.settings.claudePath === null
      ? { ok: false, message: "claude was not found." }
      : { ok: true, message: null };
  }
  if (state.apiKey === null) {
    return { ok: false, message: "No API key is saved." };
  }
  return state.apiKey.startsWith("sk-ant-")
    ? { ok: true, message: null }
    : { ok: false, message: "Anthropic rejected the key (401)." };
}

function sttStatus(): SttStatus {
  return {
    available: true,
    models: state.models.map((model) => ({ ...model })),
    selected: state.selectedModel,
  };
}

async function after<T>(ms: number, value: () => T): Promise<T> {
  await wait(ms);
  return value();
}

const commands: Record<string, (args: unknown) => Promise<unknown>> = {
  get_profile: () => after(80, () => state.profile),
  save_profile: (args) =>
    after(60, () => {
      state.profile = field(args, "profile") as Profile;
      persist();
    }),
  list_profile_facts: () => after(80, () => [...state.facts]),
  delete_profile_fact: (args) =>
    after(60, () => {
      const id = field(args, "id") as string;
      state.facts = state.facts.filter((fact) => fact.id !== id);
    }),
  get_settings: () => after(60, () => ({ ...state.settings })),
  save_settings: (args) =>
    after(60, () => {
      state.settings = field(args, "settings") as Settings;
      persist();
    }),
  set_api_key: (args) =>
    after(120, () => {
      state.apiKey = field(args, "key") as string | null;
      persist();
    }),
  has_api_key: () => after(40, () => state.apiKey !== null),
  detect_claude: () => after(700, () => "/home/you/.local/bin/claude"),
  list_models: () => after(400, listModels),
  check_provider: () => after(900, checkProvider),
  home_state: () => after(120, homeState),
  start_session: startSession,
  send_turn: sendTurn,
  help_translate: () =>
    after(700, (): HelpOption[] =>
      HELP_OPTIONS.map((option) => ({ ...option })),
    ),
  end_session: endSession,
  get_report: (args) =>
    after(200, () => {
      const sessionId = field(args, "sessionId") as string;
      return (
        state.reports.get(sessionId) ?? {
          sessionId,
          cards: reportCards(lang()),
        }
      );
    }),
  self_check: selfCheck,
  dispute_item: () => after(150, () => null),
  delete_session_audio: () => after(300, () => null),
  start_drill: startDrill,
  answer_drill: answerDrill,
  get_progress: () => after(200, () => shownProgress(progress(lang()))),
  stt_status: () => after(80, sttStatus),
  stt_download: sttDownload,
  stt_select: sttSelect,
  stt_start: sttStart,
  stt_stop: sttStop,
  stt_cancel: sttCancel,
};

export function mock<T>(command: string, args: unknown): Promise<T> {
  const handler = commands[command] ?? extraCommands(after, emit)[command];
  if (handler === undefined) {
    return Promise.reject(
      new MockCommandError("notFound", `The mock has no command ${command}.`),
    );
  }
  return handler(args) as Promise<T>;
}

restore();
