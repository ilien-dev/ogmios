import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Square } from "lucide-react";
import type { SessionSetup } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { SpiralRelief } from "@/components/scene/SpiralRelief";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import type { Navigate } from "@/app/routes";
import { useReadAloud, useSpeech } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import { endSession } from "@/lib/ipc";
import { AnalysisView } from "./AnalysisView";
import { Composer } from "./Composer";
import type { ComposerHandle } from "./Composer";
import { ConversationAside } from "./ConversationAside";
import { MessageList } from "./MessageList";
import type { PartnerState } from "./PartnerCard";
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
  const { speaking } = useSpeech();
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  // What the microphone does, for the partner's card to say.
  const [mic, setMic] = useState<RecorderStatus>("idle");
  const [words, setWords] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  const chat = useRef<HTMLDivElement>(null);
  const userTurns = state.messages.filter((m) => m.role === "user").length;
  // Only the partner is read aloud, each line once it is all there.
  const latest = state.messages.at(-1);
  useReadAloud(latest?.role === "assistant" ? latest.text : null, latest?.id);

  // The chat follows the newest words; only its own box scrolls, not the page.
  useEffect(() => {
    const box = chat.current;
    if (box !== null) {
      box.scrollTop = box.scrollHeight;
    }
  }, [state.messages.length, state.streaming]);

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

    const encouragement =
      ENCOURAGEMENTS[userTurns % ENCOURAGEMENTS.length] ?? ENCOURAGEMENTS[0];
    const thinking =
      state.phase === "waiting" ||
      state.streaming !== null ||
      mic === "transcribing";
    const partner: PartnerState =
      mic === "recording" ? "listening" : thinking ? "thinking" : "live";
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
    const meta = [
      t(`mode.${setup.mode}`),
      t(`personality.${setup.personality}`),
      t(`level.${setup.level}`),
    ].join(" · ");

    return (
      <main
        aria-label={t("conversation.label")}
        className="h-full overflow-y-auto"
      >
        <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row">
          <ConversationAside
            setup={setup}
            sessionId={state.sessionId}
            partner={partner}
            status={status}
            speaking={speaking !== null}
            words={words}
            goal={state.turnWordGoal}
            lengthHint={state.lengthHint}
            minutes={state.speechMinutes}
            mood={t("conversation.app", { text: t(encouragement) })}
            moodKey={encouragement}
            onInsert={(english) => {
              composer.current?.insert(english);
            }}
          />
          <Reveal
            kind="fade"
            index={1}
            className="flex min-h-160 min-w-0 flex-1"
          >
            <Scene
              label={t("conversation.chat")}
              className="flex-1"
              overlay={
                <div className="absolute inset-0 z-10 flex flex-col">
                  <Reveal
                    as="header"
                    kind="fade"
                    index={2}
                    className="flex shrink-0 flex-wrap items-start gap-4 px-7 pt-6"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <SceneTitle>
                        <span className="line-clamp-2">{setup.topic}</span>
                      </SceneTitle>
                      <p className="truncate text-sm text-ink-faint">{meta}</p>
                    </div>
                    <Button
                      className="group"
                      icon={
                        <Square
                          aria-hidden
                          className="size-3 fill-current transition-transform duration-300 ease-out-expo group-hover:scale-125"
                        />
                      }
                      onClick={() => void end()}
                    >
                      {t("conversation.end")}
                    </Button>
                  </Reveal>
                  <div
                    ref={chat}
                    className="min-h-0 flex-1 overflow-y-auto px-7 py-6"
                  >
                    <div className="flex min-h-full flex-col justify-end">
                      <MessageList
                        messages={state.messages}
                        streaming={state.streaming}
                        lengthHint={state.lengthHint}
                      />
                    </div>
                  </div>
                  <Reveal
                    kind="rise"
                    index={3}
                    className="flex shrink-0 flex-col gap-3 px-5 pb-5"
                  >
                    <Presence>
                      {state.targetReached && (
                        <Notice
                          key="target"
                          tone="accent"
                          icon={
                            <Flag
                              aria-hidden
                              className="size-4 text-accent-text"
                            />
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
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={dismissTarget}
                            >
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
                      ref={composer}
                      turnWordGoal={state.turnWordGoal}
                      scaffolds={state.scaffolds}
                      voice={sttModel !== null}
                      disabled={state.phase !== "ready"}
                      onSend={send}
                      onStatus={setMic}
                      onWords={setWords}
                    />
                  </Reveal>
                </div>
              }
            >
              <SpiralRelief
                dim
                className="size-full max-w-4xl animate-float px-6 pt-40 pb-32"
              />
            </Scene>
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
