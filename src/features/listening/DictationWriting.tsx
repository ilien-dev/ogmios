import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DictationItem, DictationResult } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { GRADE_TEXT, VerdictLine } from "@/components/ui/Verdict";
import { Key } from "@/features/books/TriageRun";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { cn } from "@/lib/cn";
import { VERDICT_GRADE } from "@/lib/grade";

interface DictationWritingProps {
  item: DictationItem;
  result: DictationResult | null;
  /** What was typed for the sentence judged. */
  sent: string;
  checking: boolean;
  /** The sentence judged is the last of the dictation. */
  last: boolean;
  onCheck: (text: string) => void;
  onListen: () => void;
  onNext: () => void;
}

/** The left of a dictation: where it is typed, and what it was worth. */
export function DictationWriting({
  item,
  result,
  sent,
  checking,
  last,
  onCheck,
  onListen,
  onNext,
}: DictationWritingProps): ReactNode {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const next = useRef<HTMLButtonElement>(null);

  // The keyboard is always where the next Enter belongs, from the commit that
  // shows the field or the way on: no key can land anywhere else.
  useLayoutEffect(() => {
    if (result === null) {
      field.current?.focus();
    } else {
      next.current?.focus();
    }
  }, [result]);

  const right = result?.words.filter((word) => word.heard).length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-title font-normal text-ink">
        {t("listening.run.field")}
      </h1>
      <div className="relative">
        <Presence swap>
          {result === null && (
            <Reveal key="write" kind="fade">
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  onCheck(text);
                }}
              >
                <Presence>
                  {item.retry && (
                    <Reveal
                      key="retry"
                      as="p"
                      className="text-sm text-ink-soft"
                    >
                      {t("listening.run.retry")}
                    </Reveal>
                  )}
                </Presence>
                <TextArea
                  ref={field}
                  aria-label={t("listening.run.field")}
                  rows={3}
                  spellCheck={false}
                  autoComplete="off"
                  lang="en"
                  disabled={checking}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    // By the key, not the letter: Option+L types another on a Mac.
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      onCheck(text);
                    } else if (event.altKey && event.code === "KeyN") {
                      event.preventDefault();
                      onCheck("");
                    } else if (event.altKey && event.code === "KeyL") {
                      event.preventDefault();
                      onListen();
                    }
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    variant="primaryBook"
                    disabled={checking}
                  >
                    {t("listening.run.check")}
                    <Key>{t("structures.run.checkKey")}</Key>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={checking}
                    aria-keyshortcuts={t("structures.run.skipKey")}
                    onClick={() => {
                      onCheck("");
                    }}
                  >
                    {t("listening.run.unknown")}
                    <Key>{t("structures.run.skipKey")}</Key>
                  </Button>
                </div>
              </form>
            </Reveal>
          )}
        </Presence>
      </div>
      <div aria-live="polite">
        <Presence>
          {result !== null && (
            <Reveal key="result" className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <VerdictLine tone={VERDICT_GRADE[result.verdict]}>
                  {t(`listening.run.verdict.${result.verdict}`, {
                    right,
                    total: result.words.length,
                  })}
                </VerdictLine>
                <Presence>
                  {sent !== "" && (
                    <Reveal
                      key="sent"
                      as="p"
                      className="text-ink-soft"
                      lang="en"
                    >
                      {sent}
                    </Reveal>
                  )}
                </Presence>
                <Presence>
                  {result.verdict === "partial" && (
                    <Reveal
                      key="partial"
                      as="p"
                      className="text-sm text-partial"
                    >
                      {result.slowed
                        ? t("listening.run.why.slowed")
                        : t("listening.run.why.listens")}
                    </Reveal>
                  )}
                </Presence>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-ink-faint">
                  {t("listening.run.said")}
                </p>
                <p className="text-lead text-ink" lang="en">
                  {result.words.map((word, at) => (
                    // The words of a sentence never change place.
                    <span key={at}>
                      <span
                        className={cn(
                          !word.heard &&
                            "font-medium underline decoration-2 underline-offset-4",
                          !word.heard && GRADE_TEXT.wrong,
                        )}
                      >
                        {word.text}
                      </span>{" "}
                    </span>
                  ))}
                  <SpeakButton text={result.sentence} />
                </p>
              </div>
              <Button
                ref={next}
                variant="primaryBook"
                className="self-start"
                onClick={onNext}
              >
                {last ? t("listening.run.last") : t("listening.run.next")}
                <Key>{t("structures.run.checkKey")}</Key>
              </Button>
            </Reveal>
          )}
        </Presence>
      </div>
    </div>
  );
}
