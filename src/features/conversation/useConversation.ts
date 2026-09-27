import { useEffect, useRef, useState } from "react";
import type {
  Recording,
  SessionSetup,
  SessionStarted,
  Turn,
} from "@shared/domain";
import { errorMessage } from "@/lib/errors";
import { onChatDelta, sendTurn, startSession } from "@/lib/ipc";

export interface Message {
  id: string;
  role: Turn["role"];
  text: string;
}

export type Phase = "starting" | "ready" | "waiting" | "failed";

export interface ConversationState {
  phase: Phase;
  sessionId: string | null;
  messages: Message[];
  /** The partner's reply as it streams in; null when nobody is writing. */
  streaming: string | null;
  lengthHint: string;
  turnWordGoal: number;
  scaffolds: string[];
  speechMinutes: number;
  /** Set once, when the session's speaking goal is first reached. */
  targetReached: boolean;
  error: string | null;
}

const INITIAL: ConversationState = {
  phase: "starting",
  sessionId: null,
  messages: [],
  streaming: "",
  lengthHint: "",
  turnWordGoal: 40,
  scaffolds: [],
  speechMinutes: 0,
  targetReached: false,
  error: null,
};

/**
 * One conversation with the partner: starts the session, streams each reply
 * from `chat-delta`, and sends the learner's turns.
 */
export function useConversation(setup: SessionSetup): {
  state: ConversationState;
  send: (text: string, recording: Recording | null) => Promise<boolean>;
  dismissTarget: () => void;
} {
  const [state, setState] = useState<ConversationState>(INITIAL);
  // StrictMode mounts effects twice; the session must start once.
  const started = useRef<Promise<SessionStarted> | null>(null);
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    const unlisten = onChatDelta((delta) => {
      if (sessionId.current !== null && delta.sessionId !== sessionId.current) {
        return;
      }
      setState((held) => ({
        ...held,
        streaming: (held.streaming ?? "") + delta.text,
      }));
    });
    started.current ??= startSession(setup);
    started.current
      .then((session) => {
        sessionId.current = session.sessionId;
        if (!live) {
          return;
        }
        setState((held) => ({
          ...held,
          phase: "ready",
          sessionId: session.sessionId,
          messages: [
            {
              id: session.opening.id,
              role: "assistant",
              text: session.opening.sentText,
            },
          ],
          streaming: null,
          lengthHint: session.lengthHint,
          turnWordGoal: session.turnWordGoal,
          scaffolds: session.scaffolds,
        }));
      })
      .catch((error: unknown) => {
        if (live) {
          setState((held) => ({
            ...held,
            phase: "failed",
            streaming: null,
            error: errorMessage(error),
          }));
        }
      });
    return () => {
      live = false;
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, []);

  const send = async (
    text: string,
    recording: Recording | null,
  ): Promise<boolean> => {
    const id = sessionId.current;
    if (id === null) {
      return false;
    }
    const pending: Message = {
      id: `pending-${Date.now()}`,
      role: "user",
      text,
    };
    setState((held) => ({
      ...held,
      phase: "waiting",
      error: null,
      streaming: "",
      messages: [...held.messages, pending],
    }));
    try {
      const turn = await sendTurn(id, text, recording);
      setState((held) => ({
        ...held,
        phase: "ready",
        streaming: null,
        messages: [
          ...held.messages.map((message) =>
            message.id === pending.id
              ? { ...message, id: turn.userTurn.id }
              : message,
          ),
          { id: turn.reply.id, role: "assistant", text: turn.reply.sentText },
        ],
        lengthHint: turn.lengthHint,
        scaffolds: turn.scaffolds,
        speechMinutes: turn.speechMinutes,
        targetReached: held.targetReached || turn.targetReached,
      }));
      return true;
    } catch (error) {
      setState((held) => ({
        ...held,
        phase: "ready",
        streaming: null,
        messages: held.messages.filter((message) => message.id !== pending.id),
        error: errorMessage(error),
      }));
      return false;
    }
  };

  const dismissTarget = (): void => {
    setState((held) => ({ ...held, targetReached: false }));
  };

  return { state, send, dismissTarget };
}
