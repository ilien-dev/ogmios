import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Orb } from "@/components/ui/Orb";
import { SpeakButton } from "@/features/speech/SpeakButton";
import type { Message } from "./useConversation";

interface MessageListProps {
  messages: Message[];
  streaming: string | null;
  lengthHint: string;
}

/** One line of the conversation: a message, or the reply still coming in. */
interface Line {
  /**
   * The same from the first chunk of a reply to its last, and from a turn
   * sent to the id it is given: the element is never made twice.
   */
  key: string;
  role: Message["role"];
  text: string;
  /** The reply that is still arriving, if this is it. */
  live: boolean;
  /** The message behind the line; none while its text is still streaming. */
  message: Message | null;
}

function linesOf(messages: Message[], streaming: string | null): Line[] {
  const seen = { user: 0, assistant: 0 };
  const lines: Line[] = messages.map((message) => {
    const key = `${message.role}-${String(seen[message.role])}`;
    seen[message.role] += 1;
    return {
      key,
      role: message.role,
      text: message.text,
      live: false,
      message,
    };
  });
  if (streaming !== null) {
    lines.push({
      key: `assistant-${String(seen.assistant)}`,
      role: "assistant",
      text: streaming,
      live: true,
      message: null,
    });
  }
  return lines;
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

/** A line of the partner's: its words stay while what is around them changes. */
function PartnerText({
  text,
  live,
  first,
}: {
  text: string;
  live: boolean;
  first: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <Presence swap>
        {text === "" ? (
          <Reveal
            key="waiting"
            as="span"
            kind="fade"
            className="text-base text-ink-faint motion-safe:animate-pulse-soft"
          >
            {first ? t("conversation.starting") : t("conversation.writing")}
          </Reveal>
        ) : (
          <Reveal key="words" as="span" kind="fade">
            {text}
          </Reveal>
        )}
      </Presence>
      <Presence>
        {live && text !== "" && (
          <Reveal key="caret" as="span" kind="fade">
            <span
              aria-hidden
              className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 bg-partner motion-safe:animate-caret"
            />
          </Reveal>
        )}
        {!live && (
          <Reveal key="listen" as="span" kind="fade" index={0} className="ml-1">
            <SpeakButton text={text} />
          </Reveal>
        )}
      </Presence>
    </>
  );
}

/**
 * The conversation so far, as two voices. The partner's lines sit on the
 * left in soft violet beside its small orb, each with a way to hear it again;
 * the learner's own sit on the right in their teal. Ogmios's own word, the
 * length hint, hangs under the latest question in plain ink.
 */
export function MessageList({
  messages,
  streaming,
  lengthHint,
}: MessageListProps): ReactNode {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const lines = linesOf(messages, streaming);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming]);

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-4">
        <Presence>
          {lines.map((line) =>
            line.role === "user" ? (
              <Reveal
                key={line.key}
                as="li"
                index={0}
                className="flex max-w-xl flex-col items-end gap-1.5 self-end"
              >
                <span className="text-xs font-medium text-you">
                  {t("conversation.you")}
                </span>
                <p className="rounded-lg rounded-tr-sm bg-you-soft px-5 py-3.5 text-lead text-you-ink">
                  {line.text}
                </p>
              </Reveal>
            ) : (
              <Reveal
                key={line.key}
                as="li"
                index={0}
                className="flex max-w-2xl gap-3"
              >
                <Orb size="xs" className="mt-6" />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <PartnerName />
                  <p
                    aria-live={line.live ? "polite" : undefined}
                    aria-busy={line.live ? true : undefined}
                    className="rounded-lg rounded-tl-sm bg-partner-soft px-5 py-3.5 text-lead text-ink"
                  >
                    <PartnerText
                      text={line.text}
                      live={line.live}
                      first={messages.length === 0}
                    />
                  </p>
                  <Presence>
                    {line.message !== null &&
                      line.message === last &&
                      streaming === null &&
                      lengthHint !== "" && (
                        <Reveal
                          key="lengthHint"
                          as="p"
                          className="text-xs text-ink-soft"
                        >
                          {t("conversation.app", { text: lengthHint })}
                        </Reveal>
                      )}
                  </Presence>
                </div>
              </Reveal>
            ),
          )}
        </Presence>
      </ol>
      <div ref={end} />
    </div>
  );
}
