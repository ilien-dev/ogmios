import type { MotionValue } from "motion/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Square } from "lucide-react";
import type { SessionSetup } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import type { OrbState } from "@/components/ui/Orb";
import type { Navigate } from "@/app/routes";
import { useReadAloud } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import { endSession } from "@/lib/ipc";
import { AnalysisView } from "./AnalysisView";
import { Composer } from "./Composer";
import { ConversationAside } from "./ConversationAside";
import { MessageList } from "./MessageList";
import { useConversation } from "./useConversation";
import type { RecorderStatus } from "./useRecorder";

const ENCOURAGEMENTS = [
  "conversation.encourage1",
  "conversation.encourage2",
  "conversation.encourage3",
  "conversation.encourage4",
] as const;

interface ConversationProps {
  setup: SessionSetup;
  sttModel: string | null;
  navigate: Navigate;
}

/** §6.3: talk without interruptions; the feedback waits for the end. */
export function Conversation({
  setup,
  sttModel,
  navigate,
}: ConversationProps): ReactNode {
  const { t } = useTranslation();
  const { state, send, dismissTarget } = useConversation(setup);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  // What the microphone does, and how loud: the orb listens with them.
  const [mic, setMic] = useState<RecorderStatus>("idle");
  const [level, setLevel] = useState<MotionValue<number>>();
  const userTurns = state.messages.filter((m) => m.role === "user").length;
  // Only the partner is read aloud, each line once it is all there.
  const latest = state.messages.at(-1);
  useReadAloud(latest?.role === "assistant" ? latest.text : null, latest?.id);

  const end = async (): Promise<void> => {
    if (state.sessionId === null) {
      navigate({ name: "home" });
      return;
    }
    setEnding(true);
    setEndError(null);
    try {
      const report = await endSession(state.sessionId);
      navigate({
        name: "report",
        sessionId: state.sessionId,
        report,
        origin: "session",
      });
    } catch (error) {
      setEnding(false);
      setEndError(errorMessage(error));
    }
  };

  const view = (): ReactNode => {
    if (ending && state.sessionId !== null) {
      return <AnalysisView sessionId={state.sessionId} />;
    }

    const target = setup.targetMinutes;
    const encouragement =
      ENCOURAGEMENTS[userTurns % ENCOURAGEMENTS.length] ?? ENCOURAGEMENTS[0];
    const thinking =
      state.phase === "waiting" ||
      state.streaming !== null ||
      mic === "transcribing";
    const orb: OrbState =
      mic === "recording" ? "listening" : thinking ? "thinking" : "idle";
    const status =
      mic === "recording"
        ? t("conversation.recording")
        : thinking
          ? t(
              state.streaming === "" && state.messages.length === 0
                ? "conversation.starting"
                : "conversation.writing",
            )
          : t("conversation.live");

    return (
      <main
        aria-label={t("conversation.label")}
        className="flex h-full flex-col"
      >
        <Reveal
          as="header"
          kind="fade"
          index={0}
          className="flex shrink-0 items-center gap-4 px-6 py-4 nav:px-10 nav:py-6"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="truncate text-lg font-semibold text-ink">
              {setup.topic}
            </h1>
            <p className="truncate text-xs text-ink-soft">
              {[
                t(`mode.${setup.mode}`),
                t(`personality.${setup.personality}`),
                t(`level.${setup.level}`),
              ].join(" · ")}
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<Square aria-hidden className="size-3 fill-current" />}
            onClick={() => void end()}
          >
            {t("conversation.end")}
          </Button>
        </Reveal>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6 nav:flex-row nav:gap-10 nav:px-10">
          <ConversationAside
            state={orb}
            status={status}
            level={level}
            minutes={state.speechMinutes}
            target={target}
            mood={t("conversation.app", { text: t(encouragement) })}
            moodKey={encouragement}
          />
          <Reveal
            as="section"
            index={2}
            aria-label={t("conversation.chat")}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end px-1 pb-4">
                <MessageList
                  messages={state.messages}
                  streaming={state.streaming}
                  lengthHint={state.lengthHint}
                />
              </div>
            </div>
            <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3">
              <Presence>
                {state.targetReached && (
                  <Notice
                    key="target"
                    tone="accent"
                    icon={
                      <Flag aria-hidden className="size-4 text-accent-text" />
                    }
                    className="items-center"
                  >
                    <div
                      role="status"
                      className="flex flex-wrap items-center gap-3"
                    >
                      <span className="flex-1">
                        {t("conversation.targetReached")}
                      </span>
                      <Button size="sm" variant="ghost" onClick={dismissTarget}>
                        {t("conversation.keepGoing")}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void end()}
                      >
                        {t("conversation.seeFeedback")}
                      </Button>
                    </div>
                  </Notice>
                )}
                {(state.error ?? endError) !== null && (
                  <Notice key="error" tone="danger">
                    {t("common.error", {
                      message: state.error ?? endError ?? "",
                    })}
                  </Notice>
                )}
              </Presence>
              <Composer
                sessionId={state.sessionId}
                turnWordGoal={state.turnWordGoal}
                scaffolds={state.scaffolds}
                voice={sttModel !== null}
                disabled={state.phase !== "ready"}
                onSend={send}
                onLevel={setLevel}
                onStatus={setMic}
              />
            </div>
          </Reveal>
        </div>
      </main>
    );
  };

  return (
    <Swap
      as="div"
      id={ending && state.sessionId !== null ? "analysis" : "talk"}
      className="h-full"
    >
      {view()}
    </Swap>
  );
}
