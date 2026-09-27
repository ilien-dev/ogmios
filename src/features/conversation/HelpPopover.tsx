import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CornerDownLeft, Languages, X } from "lucide-react";
import type { HelpOption } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TextInput } from "@/components/ui/TextInput";
import { errorMessage } from "@/lib/errors";
import { helpTranslate } from "@/lib/ipc";

interface HelpPopoverProps {
  sessionId: string | null;
  onInsert: (english: string) => void;
}

/**
 * "How do I say…?" (§6.3): the one live exception to "no corrections". The
 * learner writes in their own language and gets one to three English options.
 */
export function HelpPopover({
  sessionId,
  onInsert,
}: HelpPopoverProps): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [options, setOptions] = useState<HelpOption[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (open) {
      input.current?.focus();
    }
  }, [open]);

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  const insert = (english: string): void => {
    // Focus goes to the composer, where the words just landed.
    setOpen(false);
    onInsert(english);
  };

  const ask = async (): Promise<void> => {
    if (sessionId === null || text.trim() === "") {
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

  return (
    <div className="relative">
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        icon={<Languages aria-hidden className="size-4" />}
        onClick={() => {
          if (open) {
            close();
          } else {
            setOpen(true);
          }
        }}
      >
        {t("conversation.help")}
      </Button>
      {open && (
        <section
          id={panelId}
          aria-label={t("conversation.help")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
          className="absolute bottom-full left-0 z-20 mb-3 flex w-96 flex-col gap-4 rounded-lg border border-line bg-surface p-4 shadow-float motion-safe:animate-rise"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">
              {t("conversation.help")}
            </h2>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={close}
              className="grid size-7 place-items-center rounded-sm text-ink-faint hover:bg-raised hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          {/* Not a <form>: the panel lives inside the composer's form. */}
          <div className="flex gap-2">
            <label htmlFor={`${panelId}-text`} className="sr-only">
              {t("conversation.helpField")}
            </label>
            <TextInput
              ref={input}
              id={`${panelId}-text`}
              placeholder={t("conversation.helpField")}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void ask();
                }
              }}
            />
            <Button
              className="h-11"
              onClick={() => void ask()}
              disabled={asking || text.trim() === ""}
            >
              {asking ? <Spinner /> : t("conversation.helpAsk")}
            </Button>
          </div>
          <div aria-live="polite" className="flex flex-col gap-2">
            {options?.length === 0 && (
              <p className="text-sm text-ink-soft">
                {t("conversation.helpEmpty")}
              </p>
            )}
            {options?.map((option) => (
              <div
                key={option.english}
                className="flex items-center justify-between gap-3 rounded-md bg-raised px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {option.english}
                  </p>
                  {option.note !== null && (
                    <p className="text-sm text-ink-soft">{option.note}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<CornerDownLeft aria-hidden className="size-3.5" />}
                  aria-label={`${t("conversation.insert")}: ${option.english}`}
                  onClick={() => {
                    insert(option.english);
                  }}
                >
                  {t("conversation.insert")}
                </Button>
              </div>
            ))}
            {failure !== null && (
              <p role="alert" className="text-sm text-danger">
                {t("common.error", { message: failure })}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
