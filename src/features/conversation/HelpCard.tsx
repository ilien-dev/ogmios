import { useId, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Languages } from "lucide-react";
import type { HelpOption } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Spinner } from "@/components/ui/Spinner";
import { TextInput } from "@/components/ui/TextInput";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { helpTranslate } from "@/lib/ipc";

interface HelpCardProps {
  sessionId: string | null;
  onInsert: (english: string) => void;
}

/**
 * "How do I say…?" (§6.3): the one live exception to "no corrections". The
 * learner writes in their own language and gets one to three English options,
 * each a pill that drops its words into the answer.
 */
export function HelpCard({ sessionId, onInsert }: HelpCardProps): ReactNode {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [options, setOptions] = useState<HelpOption[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const id = useId();
  const closed = sessionId === null;

  const ask = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    if (sessionId === null || text.trim() === "" || asking) {
      return;
    }
    setAsking(true);
    setFailure(null);
    try {
      setOptions(await helpTranslate(sessionId, text.trim()));
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setAsking(false);
    }
  };

  const notes = (options ?? []).filter((option) => option.note !== null);

  return (
    <section
      aria-label={t("conversation.help")}
      className="flex flex-col gap-2.5 rounded-xl glass px-4.5 py-4"
    >
      <h2 className="flex items-center gap-2.5 text-base font-semibold text-ink">
        <Languages aria-hidden className="size-4.5 text-ink-soft" />
        {t("conversation.help")}
      </h2>
      <form
        onSubmit={(event) => void ask(event)}
        className="flex flex-col gap-2.5"
      >
        <label htmlFor={`${id}-text`} className="text-sm text-ink-faint">
          {t("conversation.helpField")}
        </label>
        <div className="flex gap-2">
          <TextInput
            id={`${id}-text`}
            value={text}
            disabled={closed}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <button
            type="submit"
            aria-label={t("conversation.helpAsk")}
            title={t("conversation.helpAsk")}
            disabled={closed || asking || text.trim() === ""}
            className="group grid size-11 shrink-0 place-items-center rounded-full glass text-ink transition-control hover:enabled:shadow-lift disabled:cursor-not-allowed disabled:text-ink-faint"
          >
            <Presence swap>
              <Reveal
                key={asking ? "asking" : "ask"}
                as="span"
                kind="fade"
                index={0}
                className="col-start-1 row-start-1 grid"
              >
                {asking ? (
                  <Spinner />
                ) : (
                  <ArrowRight
                    aria-hidden
                    className="size-4 transition-transform duration-300 ease-out-expo group-enabled:group-hover:translate-x-0.5"
                  />
                )}
              </Reveal>
            </Presence>
          </button>
        </div>
      </form>
      <div aria-live="polite" className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Presence>
            {options?.map((option, i) => (
              <Reveal key={option.english} as="span" kind="scale" index={i}>
                <button
                  type="button"
                  aria-label={`${t("conversation.insert")}: ${option.english}`}
                  onClick={() => {
                    onInsert(option.english);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-control hover:-translate-y-0.5 hover:shadow-lift",
                    i === 0
                      ? "border-accent/35 bg-accent-soft text-accent-text"
                      : "border-line bg-raised/60 text-ink-soft hover:text-ink",
                  )}
                >
                  {option.english}
                </button>
              </Reveal>
            ))}
          </Presence>
        </div>
        <Presence>
          {notes.map((option, i) => (
            <Reveal
              key={`note-${option.english}`}
              as="p"
              kind="fade"
              index={i}
              className="text-xs text-ink-faint"
            >
              <span className="font-medium text-ink-soft">
                {option.english}
              </span>{" "}
              · {option.note}
            </Reveal>
          ))}
          {options?.length === 0 && (
            <Reveal
              key="empty"
              as="p"
              index={0}
              className="text-sm text-ink-soft"
            >
              {t("conversation.helpEmpty")}
            </Reveal>
          )}
          {failure !== null && (
            <Reveal
              key="failure"
              as="p"
              index={0}
              role="alert"
              className="text-sm text-danger"
            >
              {t("common.error", { message: failure })}
            </Reveal>
          )}
        </Presence>
      </div>
    </section>
  );
}
