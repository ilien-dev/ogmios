import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Square } from "lucide-react";
import type { SessionSetup } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import type { Navigate } from "@/app/routes";
import { useReadAloud } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import { endSession } from "@/lib/ipc";
import { formatNumber } from "@/lib/text";
import { AnalysisView } from "./AnalysisView";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { useConversation } from "./useConversation";

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
  const { t, i18n } = useTranslation();
  const { state, send, dismissTarget } = useConversation(setup);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
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

  if (ending && state.sessionId !== null) {
    return <AnalysisView sessionId={state.sessionId} />;
  }

  const spoken = formatNumber(state.speechMinutes, i18n.language);
  const target = setup.targetMinutes;
  const encouragement =
    ENCOURAGEMENTS[userTurns % ENCOURAGEMENTS.length] ?? ENCOURAGEMENTS[0];

  return (
    <main aria-label={t("conversation.label")} className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-6 border-b border-line px-8">
        <p className="min-w-0 flex-1 truncate text-sm text-ink-soft">
          {t("conversation.topic", { topic: setup.topic })}
        </p>
        <div className="flex items-center gap-3 text-sm text-ink-faint tabular-nums">
          {target !== null && (
            <span
              aria-hidden
              className="h-1 w-24 overflow-hidden rounded-full bg-line"
            >
              <span
                className="block h-full origin-left bg-accent transition-transform duration-500 ease-out-expo"
                style={{
                  transform: `scaleX(${Math.min(1, state.speechMinutes / target)})`,
                }}
              />
            </span>
          )}
          {target === null
            ? t("conversation.speechNoTarget", { spoken })
            : t("conversation.speech", { spoken, target })}
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Square aria-hidden className="size-3 fill-current" />}
          onClick={() => void end()}
        >
          {t("conversation.end")}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-10 pt-12 pb-8">
          <MessageList
            messages={state.messages}
            streaming={state.streaming}
            lengthHint={state.lengthHint}
          />
        </div>
      </div>

      <div className="shrink-0 px-10 pb-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {state.targetReached && (
            <Notice
              tone="accent"
              icon={<Flag aria-hidden className="size-4 text-accent-text" />}
              className="items-center motion-safe:animate-rise"
            >
              <div role="status" className="flex flex-wrap items-center gap-3">
                <span className="flex-1">
                  {t("conversation.targetReached")}
                </span>
                <Button size="sm" variant="ghost" onClick={dismissTarget}>
                  {t("conversation.keepGoing")}
                </Button>
                <Button size="sm" variant="primary" onClick={() => void end()}>
                  {t("conversation.seeFeedback")}
                </Button>
              </div>
            </Notice>
          )}
          {(state.error ?? endError) !== null && (
            <Notice tone="danger">
              {t("common.error", { message: state.error ?? endError ?? "" })}
            </Notice>
          )}
          <p
            key={encouragement}
            className="text-sm text-ink-faint motion-safe:animate-fade"
          >
            {t(encouragement)}
          </p>
          <Composer
            sessionId={state.sessionId}
            turnWordGoal={state.turnWordGoal}
            scaffolds={state.scaffolds}
            voice={sttModel !== null}
            disabled={state.phase !== "ready"}
            onSend={send}
          />
        </div>
      </div>
    </main>
  );
}
