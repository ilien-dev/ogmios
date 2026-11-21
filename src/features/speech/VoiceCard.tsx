import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Mic, Volume2 } from "lucide-react";
import type { Settings, TtsStatus } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Swap } from "@/components/motion/Swap";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { saveSettings } from "@/lib/ipc";
import { formatBytes } from "@/lib/text";
import { useSpeech } from "./speech";
import type { Talk } from "./speech";

/** What stands on the right of a row: it names the control to swap by. */
type View = "loading" | "unavailable" | "fetching" | "get" | "switch";

function readView(status: TtsStatus | null, fetching: number | null): View {
  if (fetching !== null) {
    return "fetching";
  }
  if (status === null) {
    return "loading";
  }
  return status.downloaded ? "switch" : "get";
}

function talkView(talk: Talk): View {
  if (talk.fetching !== null) {
    return "fetching";
  }
  if (talk.status === null) {
    return "loading";
  }
  if (!talk.status.available) {
    return "unavailable";
  }
  return talk.status.models.some((model) => model.downloaded)
    ? "switch"
    : "get";
}

interface RowProps {
  icon: ReactNode;
  name: string;
  body: string;
  /** On: its icon takes the learner's colour. */
  on: boolean;
  /** The control on its right. */
  children: ReactNode;
}

/** One of the two things the voice does, with its control on the right. */
function Row({ icon, name, body, on, children }: RowProps): ReactNode {
  return (
    <li className="flex items-center gap-3.5 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg transition-colors duration-300 ease-out-expo",
          on ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-soft",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-ink">{name}</span>
        <span className="text-sm text-ink-faint">{body}</span>
      </span>
      <span className="relative shrink-0">{children}</span>
    </li>
  );
}

interface FetchingProps {
  label: string;
  fraction: number;
}

/** A download on its way: how far, in words and as a bar. */
function Fetching({ label, fraction }: FetchingProps): ReactNode {
  const { t } = useTranslation();
  return (
    <span className="flex w-36 flex-col gap-1.5">
      <span className="font-mono text-xs text-ink-faint tabular-nums">
        {t("voice.downloading", { percent: Math.round(fraction * 100) })}
      </span>
      <ProgressBar label={label} value={fraction} total={1} />
    </span>
  );
}

interface VoiceRowsProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  /**
   * False where the settings are a draft nothing has saved yet, as while the
   * learner is being welcomed: turning Speak off then only changes the draft.
   */
  persist?: boolean;
}

/**
 * The voice as two switches, the same wherever they show: Speak, the
 * learner's microphone, and Listen, Ogmios reading English aloud. Each is one
 * press to turn on, for downloading what it needs is all it takes, and one
 * press to turn off again.
 */
export function VoiceRows({
  settings,
  onSettingsChange,
  persist = true,
}: VoiceRowsProps): ReactNode {
  const { t, i18n } = useTranslation();
  const { status, fetching, talk, listen } = useSpeech();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Runs one change, and says why when it could not be made. */
  const attempt = async (change: () => Promise<void>): Promise<void> => {
    setFailure(null);
    setBusy(true);
    try {
      await change();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const speak = (on: boolean): Promise<void> =>
    attempt(async () => {
      if (on) {
        const sttModel = await talk.activate();
        if (sttModel !== null) {
          onSettingsChange({ ...settings, sttModel });
        }
        return;
      }
      const next = { ...settings, sttModel: null };
      if (persist) {
        await saveSettings(next);
      }
      talk.turnOff();
      onSettingsChange(next);
    });

  const hear = (on: boolean): Promise<void> => attempt(() => listen.turn(on));

  const heard = talkView(talk);
  const wanted = talk.status?.models.find(
    (model) => model.id === talk.status?.selected,
  );
  const first = wanted ?? talk.status?.models[0];
  const talkSize =
    first === undefined ? "" : formatBytes(first.bytes, i18n.language);
  const read = readView(status, fetching);
  const readSize =
    status === null ? "" : formatBytes(status.bytes, i18n.language);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        <Row
          icon={<Mic className="size-4" />}
          name={t("voice.talk")}
          body={
            heard === "unavailable"
              ? t("voice.unavailable")
              : t("voice.talkBody")
          }
          on={talk.on}
        >
          <Swap id={heard}>
            {heard === "loading" && <Spinner />}
            {heard === "fetching" && (
              <Fetching
                label={t("voice.talkProgress")}
                fraction={talk.fetching ?? 0}
              />
            )}
            {heard === "get" && (
              <Button
                size="sm"
                disabled={busy}
                aria-label={t("voice.talkGet", { size: talkSize })}
                icon={<Download aria-hidden className="size-4" />}
                onClick={() => void speak(true)}
              >
                {t("voice.get", { size: talkSize })}
              </Button>
            )}
            {heard === "switch" && (
              <Switch
                checked={talk.on}
                label={t("voice.talk")}
                disabled={busy}
                onChange={(on) => void speak(on)}
              />
            )}
          </Swap>
        </Row>
        <Row
          icon={<Volume2 className="size-4" />}
          name={t("voice.listen")}
          body={t("voice.listenBody")}
          on={listen.on}
        >
          <Swap id={read}>
            {read === "loading" && <Spinner />}
            {read === "fetching" && (
              <Fetching
                label={t("readAloud.progressLabel")}
                fraction={fetching ?? 0}
              />
            )}
            {read === "get" && (
              <Button
                size="sm"
                disabled={busy}
                aria-label={t("voice.listenGet", { size: readSize })}
                icon={<Download aria-hidden className="size-4" />}
                onClick={() => void hear(true)}
              >
                {t("voice.get", { size: readSize })}
              </Button>
            )}
            {read === "switch" && (
              <Switch
                checked={listen.on}
                label={t("voice.listen")}
                disabled={busy}
                onChange={(on) => void hear(on)}
              />
            )}
          </Swap>
        </Row>
      </ul>
      <Presence>
        {failure !== null && (
          <Notice key="failure" tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </Presence>
    </div>
  );
}

interface VoiceCardProps extends VoiceRowsProps {
  className?: string;
}

/** The two switches on a glass card of their own, as Chat shows them. */
export function VoiceCard({ className, ...rows }: VoiceCardProps): ReactNode {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="voice-card"
      className={cn("flex flex-col gap-3.5 rounded-xl glass p-4.5", className)}
    >
      <header className="flex flex-col gap-1">
        <h2
          id="voice-card"
          className="font-display text-base font-semibold tracking-tight text-ink"
        >
          {t("voice.title")}
        </h2>
        <p className="text-sm text-ink-soft">{t("voice.lead")}</p>
      </header>
      <VoiceRows {...rows} />
    </section>
  );
}

/**
 * Listen as one small control, for a screen with no room for the rows: it
 * says whether English is read aloud by itself, and turns that on or off.
 * Before the voice is on disk it is how to get it.
 */
export function ListenToggle({ className }: { className?: string }): ReactNode {
  const { t } = useTranslation();
  const { status, fetching, listen } = useSpeech();
  const [busy, setBusy] = useState(false);
  if (status === null) {
    return null;
  }
  const view = readView(status, fetching);
  const name = t("voice.listen");
  return (
    <button
      type="button"
      aria-pressed={view === "switch" ? listen.on : undefined}
      disabled={busy || fetching !== null}
      onClick={() => {
        setBusy(true);
        // A failed download can be pressed again; the settings say why.
        void listen
          .turn(!listen.on)
          .catch(() => null)
          .finally(() => {
            setBusy(false);
          });
      }}
      className={cn(
        "group inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-control disabled:cursor-not-allowed",
        listen.on
          ? "border-accent-strong bg-accent-soft text-ink"
          : "border-line bg-surface/80 text-ink-soft hover:text-ink",
        className,
      )}
    >
      <Volume2
        aria-hidden
        className="size-4 shrink-0 transition-transform duration-300 ease-out-expo group-enabled:group-hover:scale-110"
      />
      <span className="relative">
        <Swap id={view === "switch" ? String(listen.on) : view}>
          {view === "fetching"
            ? t("speech.getting", {
                percent: Math.round((fetching ?? 0) * 100),
              })
            : view === "get"
              ? t("voice.activateListen")
              : listen.on
                ? t("voice.on", { name })
                : t("voice.off", { name })}
        </Swap>
      </span>
    </button>
  );
}
