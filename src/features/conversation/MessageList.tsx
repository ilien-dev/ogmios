import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, User } from "lucide-react";
import { SpeakButton } from "@/features/speech/SpeakButton";
import type { Message } from "./useConversation";

interface MessageListProps {
  messages: Message[];
  streaming: string | null;
  lengthHint: string;
}

/** Who is speaking, beside each line: a small square in that voice's colour. */
function Avatar({ role }: { role: Message["role"] }): ReactNode {
  return role === "user" ? (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-sm bg-you-soft text-you"
    >
      <User className="size-4" />
    </span>
  ) : (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-sm bg-partner-soft text-partner"
    >
      <AudioLines className="size-4" />
    </span>
  );
}

function PartnerName(): ReactNode {
  const { t } = useTranslation();
  return (
    <span className="text-xs font-medium text-partner">
      {t("conversation.partner")}{" "}
      <span className="font-normal text-ink-faint">
        · {t("conversation.ai")}
      </span>
    </span>
  );
}

/**
 * The conversation so far, as two voices. The partner's lines sit on the
 * left in plain bubbles, each with a way to hear it again; the learner's own
 * sit on the right in their teal. Ogmios's own word, the length hint, hangs
 * under the latest question in plain ink.
 */
export function MessageList({
  messages,
  streaming,
  lengthHint,
}: MessageListProps): ReactNode {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming]);

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-6">
        {messages.map((message) =>
          message.role === "user" ? (
            <li
              key={message.id}
              className="flex max-w-xl flex-row-reverse gap-3 self-end"
            >
              <Avatar role="user" />
              <div className="flex flex-col items-end gap-1.5">
                <span className="text-xs font-medium text-you">
                  {t("conversation.you")}
                </span>
                <p className="rounded-lg rounded-tr-none border border-you-line bg-you-soft px-4 py-3 leading-relaxed text-you-ink">
                  {message.text}
                </p>
              </div>
            </li>
          ) : (
            <li key={message.id} className="flex max-w-2xl gap-3">
              <Avatar role="assistant" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <PartnerName />
                <p className="rounded-lg rounded-tl-none border border-line bg-surface px-4 py-3 text-lead text-ink">
                  {message.text}
                  <SpeakButton text={message.text} className="ml-1" />
                </p>
                {message === last &&
                  streaming === null &&
                  lengthHint !== "" && (
                    <p className="text-xs text-ink-soft">
                      {t("conversation.app", { text: lengthHint })}
                    </p>
                  )}
              </div>
            </li>
          ),
        )}
      </ol>
      {streaming !== null && (
        <div className="flex max-w-2xl gap-3">
          <Avatar role="assistant" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <PartnerName />
            <p
              aria-live="polite"
              aria-busy
              className="rounded-lg rounded-tl-none border border-line bg-surface px-4 py-3 text-lead text-ink"
            >
              {streaming === "" ? (
                <span className="text-base text-ink-faint motion-safe:animate-pulse-soft">
                  {messages.length === 0
                    ? t("conversation.starting")
                    : t("conversation.writing")}
                </span>
              ) : (
                <>
                  {streaming}
                  <span
                    aria-hidden
                    className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 bg-partner motion-safe:animate-caret"
                  />
                </>
              )}
            </p>
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
