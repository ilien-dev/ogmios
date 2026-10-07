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
import type { UpdateDownload } from "@shared/domain";
import { errorMessage } from "@/lib/errors";
import {
  appVersion,
  checkUpdate,
  downloadUpdate,
  installUpdate,
  onUpdateDownload,
} from "@/lib/ipc";

/**
 * Where the app stands against the latest release. A `failed` with a version
 * is a download or an install that failed; without one, a check that did.
 */
export type UpdateState =
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; progress: UpdateDownload | null }
  | { kind: "ready"; version: string }
  | { kind: "installing"; version: string }
  | { kind: "failed"; version: string | null; message: string };

export interface Updates {
  /** The running version; null until it is known. */
  version: string | null;
  state: UpdateState;
  /** The learner put the card away; the sidebar still points to the release. */
  folded: boolean;
  /** Looks for a newer release now, and says so while it does. */
  check: () => void;
  /** Downloads the newer release while the app stays in use. */
  download: () => void;
  /** Installs what was downloaded and restarts into it. */
  restart: () => void;
  later: () => void;
  unfold: () => void;
}

function quiet(): void {
  // Nothing checks for updates here.
}

const NONE: Updates = {
  version: null,
  state: { kind: "current" },
  folded: true,
  check: quiet,
  download: quiet,
  restart: quiet,
  later: quiet,
  unfold: quiet,
};

export const UpdateContext = createContext<Updates>(NONE);

const HOUR = 3_600_000;
const FIVE_MINUTES = 300_000;

/** The release on offer, in whatever state it is; null when there is none. */
export function offered(state: UpdateState): string | null {
  return state.kind === "checking" || state.kind === "current"
    ? null
    : state.version;
}

/** A download or an install under way is not a check's to interrupt. */
function settled(state: UpdateState): boolean {
  return (
    state.kind !== "downloading" &&
    state.kind !== "ready" &&
    state.kind !== "installing"
  );
}

interface UpdateProviderProps {
  children: ReactNode;
  /** How often it looks for a newer release while the app is open. */
  every?: number;
  /** How long after a look the window coming back does not look again. */
  rest?: number;
}

/**
 * The one place that knows about updates, for the sidebar, the settings and
 * the card. It looks at start-up, every hour and when the window comes back;
 * a look nobody asked for that fails says nothing and changes nothing.
 * Nothing downloads or restarts unless the learner asks.
 */
export function UpdateProvider({
  children,
  every = HOUR,
  rest = FIVE_MINUTES,
}: UpdateProviderProps): ReactNode {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ kind: "checking" });
  const [folded, setFolded] = useState(false);
  const looked = useRef(0);

  const look = useCallback(async (asked: boolean): Promise<void> => {
    looked.current = Date.now();
    if (asked) {
      setState((held) => (settled(held) ? { kind: "checking" } : held));
    }
    try {
      const update = await checkUpdate();
      setState((held) => {
        if (!settled(held)) {
          return held;
        }
        return update === null
          ? { kind: "current" }
          : { kind: "available", version: update.version };
      });
    } catch (error) {
      if (asked) {
        setState((held) =>
          settled(held)
            ? { kind: "failed", version: null, message: errorMessage(error) }
            : held,
        );
      }
    }
  }, []);

  useEffect(() => {
    let live = true;
    void appVersion().then((current) => {
      if (live) {
        setVersion(current);
      }
    });
    void look(true);
    const unlisten = onUpdateDownload((progress) => {
      setState((held) =>
        held.kind === "downloading" ? { ...held, progress } : held,
      );
    });
    return () => {
      live = false;
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [look]);

  useEffect(() => {
    const timer = setInterval(() => {
      void look(false);
    }, every);
    const back = (): void => {
      if (Date.now() - looked.current >= rest) {
        void look(false);
      }
    };
    globalThis.addEventListener("focus", back);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener("focus", back);
    };
  }, [look, every, rest]);

  const release = offered(state);

  const download = useCallback(async (): Promise<void> => {
    if (release === null) {
      return;
    }
    setState({ kind: "downloading", version: release, progress: null });
    try {
      await downloadUpdate();
      setState({ kind: "ready", version: release });
    } catch (error) {
      setState({
        kind: "failed",
        version: release,
        message: errorMessage(error),
      });
    }
  }, [release]);

  const restart = useCallback(async (): Promise<void> => {
    if (release === null) {
      return;
    }
    setState({ kind: "installing", version: release });
    try {
      await installUpdate();
      setState({ kind: "current" });
    } catch (error) {
      setState({
        kind: "failed",
        version: release,
        message: errorMessage(error),
      });
    }
  }, [release]);

  const updates = useMemo<Updates>(
    () => ({
      version,
      state,
      folded,
      check: () => {
        void look(true);
      },
      download: () => {
        void download();
      },
      restart: () => {
        void restart();
      },
      later: () => {
        setFolded(true);
      },
      unfold: () => {
        setFolded(false);
      },
    }),
    [version, state, folded, look, download, restart],
  );

  return (
    <UpdateContext.Provider value={updates}>{children}</UpdateContext.Provider>
  );
}

export function useUpdate(): Updates {
  return useContext(UpdateContext);
}
