import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { cn } from "@/lib/cn";
import type { Message } from "./useConversation";

interface MessageListProps {
  messages: Message[];
  streaming: string | null;
  lengthHint: string;
}

/**
 * The conversation so far. The partner's lines sit on the page like text,
 * each with a way to hear it again; the learner's own sit in quiet bubbles on
 * the right. The length hint hangs under the latest question.
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
    <div className="flex flex-col gap-8">
      <ol className="flex flex-col gap-8">
        {messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              "flex flex-col gap-2",
              message.role === "user" && "items-end",
            )}
          >
            <span className="sr-only">
              {message.role === "user"
                ? t("conversation.you")
                : t("conversation.partner")}
            </span>
            {message.role === "user" ? (
              <p className="max-w-lg rounded-xl rounded-br-sm bg-raised px-4 py-3 leading-relaxed text-ink">
                {message.text}
              </p>
            ) : (
              <p className="max-w-2xl text-lead text-ink">
                {message.text}
                <SpeakButton text={message.text} className="ml-1" />
              </p>
            )}
            {message === last &&
              message.role === "assistant" &&
              streaming === null &&
              lengthHint !== "" && (
                <p className="text-sm text-ink-faint">{lengthHint}</p>
              )}
          </li>
        ))}
      </ol>
      {streaming !== null && (
        <div className="flex flex-col gap-2">
          <span className="sr-only">{t("conversation.partner")}</span>
          <p
            aria-live="polite"
            aria-busy
            className="max-w-2xl text-lead text-ink"
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
                  className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 bg-accent motion-safe:animate-caret"
                />
              </>
            )}
          </p>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
