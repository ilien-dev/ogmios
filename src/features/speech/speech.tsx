import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { TtsStatus } from "@shared/domain";
import {
  onTtsDownload,
  ttsDownload,
  ttsSpeak,
  ttsStatus,
  ttsStop,
} from "@/lib/ipc";

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
    const unlisten = onTtsDownload((event) => {
      setFetching((held) =>
        held === null || event.total === 0
          ? held
          : event.received / event.total,
      );
    });
    return () => {
      live = false;
      void unlisten.then((stop) => {
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

  const speech = useMemo(
    () => ({ status, speaking, say, hush, fetching, fetch, setStatus }),
    [status, speaking, say, hush, fetching, fetch],
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
 * silences it.
 */
export function useReadAloud(text: string | null, key = ""): void {
  const { status, say, hush } = useSpeech();
  const auto = status?.downloaded === true && status.enabled;

  useEffect(() => {
    if (auto && text !== null) {
      say(text);
    }
  }, [auto, text, key, say]);

  useEffect(() => hush, [hush]);
}
