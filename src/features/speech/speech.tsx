import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useIsPresent } from "motion/react";
import type { SttStatus, TtsStatus } from "@shared/domain";
import {
  onSttDownload,
  onTtsDownload,
  sttDownload,
  sttSelect,
  sttStatus,
  ttsConfigure,
  ttsDownload,
  ttsSpeak,
  ttsStatus,
  ttsStop,
} from "@/lib/ipc";

/** Speak: the learner says their turns and the microphone writes them. */
export interface Talk {
  /** Null until it is known, and where nothing provides a microphone. */
  status: SttStatus | null;
  /** A model is picked and the learner has not turned speaking off. */
  on: boolean;
  /** How far a model's download is, nought to one; null while none runs. */
  fetching: number | null;
  /**
   * Turns speaking on: downloads a model when none is on disk, then picks
   * it, for downloading is all it takes. Resolves to the model in use, null
   * where there is none to have; rejects with why it could not.
   */
  activate: () => Promise<string | null>;
  /** Turns speaking off; the model stays on disk for the next time. */
  turnOff: () => void;
  /** Reads again what is on disk and picked, after it changed elsewhere. */
  refresh: () => Promise<void>;
}

/** Listen: the voice reads English aloud by itself as it appears. */
export interface Listen {
  /** The voice is on disk and reads by itself. */
  on: boolean;
  /**
   * Turns reading by itself on or off. Turning it on downloads the voice
   * first when it is not on disk. Rejects with why it could not.
   */
  turn: (on: boolean) => Promise<void>;
}

interface Speech {
  /** Null until it is known, and where nothing provides a voice. */
  status: TtsStatus | null;
  /** What is being read aloud now; null in silence. */
  speaking: string | null;
  /** Reads English aloud, over whatever was being read. */
  say: (text: string) => void;
  hush: () => void;
  /** How far the voice's download is, nought to one; null while none runs. */
  fetching: number | null;
  /** Downloads the voice. Rejects with why it could not. */
  fetch: () => Promise<void>;
  /** The settings changed the voice. */
  setStatus: (status: TtsStatus) => void;
  talk: Talk;
  listen: Listen;
}

function quiet(): void {
  // Nothing provides a voice here.
}

const SILENT: Speech = {
  status: null,
  speaking: null,
  say: quiet,
  hush: quiet,
  fetching: null,
  fetch: () => Promise.resolve(),
  setStatus: quiet,
  talk: {
    status: null,
    on: false,
    fetching: null,
    activate: () => Promise.resolve(null),
    turnOff: quiet,
    refresh: () => Promise.resolve(),
  },
  listen: { on: false, turn: () => Promise.resolve() },
};

const SpeechContext = createContext<Speech>(SILENT);

/**
 * The voice that reads English aloud, for every screen under it. Only English
 * is ever handed to it: the learner's own language needs no reading. Without
 * the voice downloaded it stays silent and offers the download wherever it
 * would have read; a screen outside of it is silent and offers nothing.
 */
export function SpeechProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const turn = useRef(0);
  // A stop still on its way must land before the next thing is said.
  const stopping = useRef<Promise<unknown>>(Promise.resolve());
  const [fetching, setFetching] = useState<number | null>(null);
  const ready = status?.downloaded === true;
  const [heard, setHeard] = useState<SttStatus | null>(null);
  // Off for now: the model stays picked, so that on is one press away.
  const [muted, setMuted] = useState(false);
  const [hearing, setHearing] = useState<number | null>(null);
  /** The model this provider is downloading; the settings download others. */
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    ttsStatus()
      .then((loaded) => {
        if (live) {
          setStatus(loaded);
        }
      })
      .catch(() => {
        // No voice is a quiet app, not a broken one.
      });
    sttStatus()
      .then((loaded) => {
        if (live) {
          setHeard(loaded);
        }
      })
      .catch(() => {
        // No microphone is an app that is typed in, not a broken one.
      });
    const unlisten = onTtsDownload((event) => {
      setFetching((held) =>
        held === null || event.total === 0
          ? held
          : event.received / event.total,
      );
    });
    const unhear = onSttDownload((event) => {
      if (event.modelId === wanted.current && event.total > 0) {
        setHearing(event.received / event.total);
      }
    });
    return () => {
      live = false;
      void unlisten.then((stop) => {
        stop();
      });
      void unhear.then((stop) => {
        stop();
      });
    };
  }, []);

  const fetch = useCallback(async (): Promise<void> => {
    setFetching(0);
    try {
      await ttsDownload();
      setStatus(await ttsStatus());
    } finally {
      setFetching(null);
    }
  }, []);

  const hush = useCallback((): void => {
    turn.current += 1;
    setSpeaking(null);
    stopping.current = ttsStop().catch(() => null);
  }, []);

  const say = useCallback(
    (text: string): void => {
      if (!ready || text.trim() === "") {
        return;
      }
      turn.current += 1;
      const mine = turn.current;
      setSpeaking(text);
      void stopping.current
        .then(() => ttsSpeak(text))
        .catch(() => null)
        .then(() => {
          if (turn.current === mine) {
            setSpeaking(null);
          }
        });
    },
    [ready],
  );

  const activate = useCallback(async (): Promise<string | null> => {
    const found = await sttStatus();
    const model =
      found.models.find((each) => each.id === found.selected) ??
      found.models.find((each) => each.downloaded) ??
      found.models[0];
    if (!found.available || model === undefined) {
      setHeard(found);
      return null;
    }
    if (!model.downloaded) {
      wanted.current = model.id;
      setHearing(0);
      try {
        await sttDownload(model.id);
      } finally {
        wanted.current = null;
        setHearing(null);
      }
    }
    await sttSelect(model.id);
    setHeard(await sttStatus());
    setMuted(false);
    return model.id;
  }, []);

  const turnOff = useCallback((): void => {
    setMuted(true);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setHeard(await sttStatus());
    setMuted(false);
  }, []);

  const downloaded = status?.downloaded === true;
  const reading = downloaded && status.enabled;
  const turnListening = useCallback(
    async (on: boolean): Promise<void> => {
      if (on && !downloaded) {
        await fetch();
      }
      const found = await ttsStatus();
      setStatus(
        found.enabled === on ? found : await ttsConfigure(found.voice, on),
      );
    },
    [downloaded, fetch],
  );

  const talk = useMemo(
    () => ({
      status: heard,
      on: heard !== null && heard.selected !== null && !muted,
      fetching: hearing,
      activate,
      turnOff,
      refresh,
    }),
    [heard, muted, hearing, activate, turnOff, refresh],
  );
  const listen = useMemo(
    () => ({ on: reading, turn: turnListening }),
    [reading, turnListening],
  );

  const speech = useMemo(
    () => ({
      status,
      speaking,
      say,
      hush,
      fetching,
      fetch,
      setStatus,
      talk,
      listen,
    }),
    [status, speaking, say, hush, fetching, fetch, talk, listen],
  );
  return (
    <SpeechContext.Provider value={speech}>{children}</SpeechContext.Provider>
  );
}

export function useSpeech(): Speech {
  return useContext(SpeechContext);
}

/**
 * Reads `text` aloud by itself when it appears, where the learner left that
 * on. `key` tells two appearances of the same text apart. Leaving the screen
 * silences it. What is swapped out by an animation falls silent as it starts
 * to leave, before what replaces it speaks: by the time it unmounts, that is
 * being read, and hushing then would cut it off.
 */
export function useReadAloud(text: string | null, key = ""): void {
  const { status, say, hush } = useSpeech();
  const auto = status?.downloaded === true && status.enabled;
  const present = useIsPresent();
  const silenced = useRef(false);

  useLayoutEffect(() => {
    silenced.current = !present;
    if (!present) {
      hush();
    }
  }, [present, hush]);

  useEffect(() => {
    if (auto && text !== null && present) {
      say(text);
    }
  }, [auto, text, key, say, present]);

  useEffect(
    () => () => {
      if (!silenced.current) {
        hush();
      }
    },
    [hush],
  );
}
