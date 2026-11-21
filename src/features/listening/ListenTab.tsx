import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ListeningState, Pace } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import type { Navigate } from "@/app/routes";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { useSpeech } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import { closeDictation, listeningState, startDictation } from "@/lib/ipc";
import { formatBytes } from "@/lib/text";
import { Escaping } from "./Escaping";
import { OnChapter } from "./OnChapter";
import { PaceGauges } from "./PaceGauges";
import { PausedDictations } from "./PausedDictations";

interface ListenTabProps {
  /** The chapter the learner is on. */
  chapterId: string;
  navigate: Navigate;
}

/**
 * Listening to the chapter the learner is on: how much the learner hears at
 * each pace, hearing it read aloud from where it was left, a dictation of its sentences, the dictations left
 * unfinished and the words that escape the ear. Without the voice it only
 * offers to get it.
 */
export function ListenTab({ chapterId, navigate }: ListenTabProps): ReactNode {
  const { t, i18n } = useTranslation();
  const { status, fetching, fetch } = useSpeech();
  const [state, setState] = useState<ListeningState | null>(null);
  /** The pace picked for the next dictation; null for the one offered. */
  const [picked, setPicked] = useState<Pace | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listeningState(chapterId)
      .then((loaded) => {
        if (live) {
          setState(loaded);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    return () => {
      live = false;
    };
  }, [chapterId]);

  /** Runs one step with the backend, showing why it failed if it does. */
  const run = async (step: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await step();
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  const on = state?.chapter ?? null;
  const voiceless = status !== null && !status.downloaded;
  const shown = state !== null && !voiceless;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-medium tracking-tight text-ink">
          {t("listening.title")}
        </h2>
        <p className="max-w-prose text-sm text-ink-soft">
          {t("listening.intro")}
        </p>
      </header>
      <Presence>
        {failure !== null && (
          <Notice key="failure" tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </Presence>
      <Presence>
        {state === null && failure === null && !voiceless && (
          <Reveal key="wait" kind="fade">
            <Spinner />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {voiceless && (
          <Reveal
            as="section"
            key="voice"
            className="flex flex-col items-start gap-4"
          >
            <Notice>{t("listening.voice.need")}</Notice>
            <Button
              variant="primaryBook"
              disabled={fetching !== null}
              onClick={() => {
                fetch().catch((error: unknown) => {
                  setFailure(errorMessage(error));
                });
              }}
            >
              {fetching === null
                ? t("listening.voice.get", {
                    size: formatBytes(status.bytes, i18n.language),
                  })
                : t("listening.voice.getting", {
                    percent: Math.round(fetching * 100),
                  })}
            </Button>
          </Reveal>
        )}
      </Presence>
      <Presence>
        {shown && (
          <Reveal key="gauges">
            <PaceGauges standings={state.standings} />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {shown && on !== null && (
          <Reveal key="on">
            <OnChapter
              on={on}
              pace={picked ?? state.pace}
              busy={busy}
              onPace={setPicked}
              onDictation={() =>
                void run(async () => {
                  const sitting = await startDictation(
                    on.chapter.id,
                    picked ?? state.pace,
                  );
                  navigate({ name: "listening", running: sitting.id });
                })
              }
              onListen={() => {
                navigate({ name: "listening", reading: on.chapter.id });
              }}
            />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {shown && state.paused.length > 0 && (
          <Reveal key="paused">
            <PausedDictations
              paused={state.paused}
              onContinue={(id) => {
                navigate({ name: "listening", running: id });
              }}
              onEnd={(id) =>
                void run(async () => {
                  await closeDictation(id, true);
                  setState(await listeningState(chapterId));
                })
              }
            />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {shown && state.missed.length > 0 && (
          <Reveal key="missed">
            <Escaping state={state} />
          </Reveal>
        )}
      </Presence>
    </div>
  );
}
