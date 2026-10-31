import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Info, Square } from "lucide-react";
import type { SessionSetup } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Waveform } from "@/components/ui/Waveform";
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
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-10 py-4 bg-glow">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate font-display text-2xl font-light text-ink">
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
        <p className="flex items-center gap-2 rounded-sm bg-you-soft px-2.5 py-1 text-xs font-medium text-you">
          <Waveform bars={16} className="h-3.5" />
          {t("conversation.live")}
        </p>
        <div className="flex items-center gap-3 text-xs text-ink-soft tabular-nums">
          {target !== null && (
            <span
              aria-hidden
              className="h-0.5 w-28 overflow-hidden bg-line-strong"
            >
              <span
                className="block h-full origin-left bg-you transition-transform duration-500 ease-out-expo"
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
          variant="inverse"
          size="sm"
          icon={<Square aria-hidden className="size-3 fill-current" />}
          onClick={() => void end()}
        >
          {t("conversation.end")}
        </Button>
      </header>
      <div aria-hidden className="h-0.5 shrink-0 opacity-70 bg-voices" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-10 pt-10 pb-8">
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
            className="flex items-center gap-3 text-xs text-ink-soft motion-safe:animate-fade"
          >
            <span aria-hidden className="h-px flex-1 bg-line-strong" />
            <Info aria-hidden className="size-3.5 shrink-0" />
            {t("conversation.app", { text: t(encouragement) })}
            <span aria-hidden className="h-px flex-1 bg-line-strong" />
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
