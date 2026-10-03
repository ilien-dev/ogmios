import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, RotateCcw, X } from "lucide-react";
import type { Drill, DrillItem, DrillResult } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { TextArea } from "@/components/ui/TextArea";
import { GRADE_FILL, VerdictLine } from "@/components/ui/Verdict";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { grade } from "@/lib/grade";
import type { Grade } from "@/lib/grade";
import { answerDrill } from "@/lib/ipc";
import { SpotErrorChoice } from "./SpotErrorChoice";

interface Answered {
  item: DrillItem;
  response: string;
  result: DrillResult;
}

/** What each grade is called. */
const VERDICT = {
  right: "drills.right",
  partial: "drills.rightRetry",
  wrong: "drills.notQuite",
} as const;

interface DrillRunnerProps {
  drill: Drill;
  onAgain: () => void;
  onClose: () => void;
}

/**
 * Runs a drill item by item (§9.2): answer, feedback, and after a miss one
 * similar item to try again. Consecutive `guidedChat` items read as one short
 * conversation, each prompt a line from the partner.
 */
export function DrillRunner({
  drill,
  onAgain,
  onClose,
}: DrillRunnerProps): ReactNode {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<DrillItem[]>(drill.items);
  const [position, setPosition] = useState(0);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [response, setResponse] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const item = queue[position];
  const current = answered.find((entry) => entry.item === item);
  // An item that follows a miss is a second chance: right there is partly right.
  const retries = new Set(answered.map((entry) => entry.result.retry));
  const graded = (entry: Answered): Grade =>
    grade(entry.result.correct, retries.has(entry.item));
  const fill = (entry: DrillItem, i: number): string => {
    const done = answered.find((held) => held.item === entry);
    if (done !== undefined) {
      return GRADE_FILL[graded(done)];
    }
    return i <= position ? "bg-accent" : "bg-line";
  };

  useEffect(() => {
    field.current?.focus();
  }, [position, picked]);

  if (item === undefined) {
    const correct = answered.filter((entry) => entry.result.correct).length;
    return (
      <main className="grid h-full place-items-center px-10">
        <div className="flex w-full max-w-lg flex-col gap-8 motion-safe:animate-rise">
          <h1 className="text-display font-semibold text-ink">
            {t("drills.summary")}
          </h1>
          <div className="flex flex-col gap-3">
            <ol aria-hidden className="flex gap-1.5">
              {answered.map((entry) => (
                <li
                  key={entry.item.index}
                  className={cn(
                    "h-1.5 flex-1 rounded-full",
                    GRADE_FILL[graded(entry)],
                  )}
                />
              ))}
            </ol>
            <p className="text-lead text-ink">
              {t("drills.summaryCount", { correct, total: answered.length })}
            </p>
          </div>
          <p className="text-ink-soft">{t("drills.summaryNote")}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={onAgain}>
              {t("drills.again")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("drills.home")}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    const text = response.trim();
    if (text === "" || checking) {
      return;
    }
    setChecking(true);
    setFailure(null);
    try {
      const result = await answerDrill(drill.id, item.index, text);
      setAnswered((held) => [...held, { item, response: text, result }]);
      if (result.retry !== null) {
        const retry = result.retry;
        setQueue((held) => [
          ...held.slice(0, position + 1),
          retry,
          ...held.slice(position + 1),
        ]);
      }
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  const next = (): void => {
    setResponse("");
    setPicked(null);
    setPosition((held) => held + 1);
  };

  // The guided chat so far: earlier exchanges of the run of guidedChat items
  // that ends at the current one.
  const thread: Answered[] = [];
  if (item.format === "guidedChat") {
    for (let i = position - 1; i >= 0; i -= 1) {
      const earlier = answered.find((entry) => entry.item === queue[i]);
      if (earlier?.item.format !== "guidedChat") {
        break;
      }
      thread.unshift(earlier);
    }
  }

  const needsPick = item.format === "spotError" && picked === null;

  return (
    <main className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-6 px-8">
        <ol aria-hidden className="flex flex-1 gap-1.5">
          {queue.map((entry, i) => (
            <li
              key={entry.index}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                fill(entry, i),
              )}
            />
          ))}
        </ol>
        <p className="text-sm text-ink-faint tabular-nums">
          {t("drills.item", { current: position + 1, total: queue.length })}
        </p>
        <button
          type="button"
          aria-label={t("drills.close")}
          onClick={onClose}
          className="grid size-9 place-items-center rounded-md text-ink-faint hover:bg-raised hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section
          key={item.index}
          aria-label={t("drills.item", {
            current: position + 1,
            total: queue.length,
          })}
          className="mx-auto flex max-w-2xl flex-col gap-8 px-10 pt-10 pb-12 motion-safe:animate-rise"
        >
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-ink-faint">
              {t(`drillFormat.${item.format}`)}
            </p>
            {item.focus !== "" && (
              <p className="text-ink-soft">
                {t("drills.focus", { pattern: item.focus })}
              </p>
            )}
          </div>

          {thread.length > 0 && (
            <ol className="flex flex-col gap-6">
              {thread.map((entry) => (
                <li key={entry.item.index} className="flex flex-col gap-3">
                  <p className="text-lead text-ink-soft">{entry.item.prompt}</p>
                  <p className="max-w-lg self-end rounded-xl rounded-br-sm bg-raised px-4 py-3 text-ink-soft">
                    {entry.response}
                  </p>
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-col gap-3">
            <h1 className="text-lead font-medium text-balance text-ink">
              {item.prompt}
            </h1>
            <p className="text-ink-soft">{item.instruction}</p>
          </div>

          {needsPick ? (
            <SpotErrorChoice
              options={item.options}
              onPick={(sentence) => {
                setPicked(sentence);
                setResponse(sentence);
              }}
            />
          ) : (
            <form
              onSubmit={(event) => void submit(event)}
              className="flex flex-col gap-3"
            >
              <label
                htmlFor="drill-answer"
                className="text-sm font-medium text-ink"
              >
                {item.format === "spotError"
                  ? t("drills.fixIt")
                  : t("drills.answer")}
              </label>
              <TextArea
                ref={field}
                id="drill-answer"
                rows={2}
                value={response}
                readOnly={current !== undefined}
                onChange={(event) => {
                  setResponse(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (current === undefined) {
                      void submit(event);
                    }
                  }
                }}
              />
              {current === undefined && (
                <div>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={checking || response.trim() === ""}
                    icon={
                      checking ? (
                        <Spinner className="text-on-accent" />
                      ) : undefined
                    }
                  >
                    {checking ? t("drills.checking") : t("drills.check")}
                  </Button>
                </div>
              )}
            </form>
          )}

          {failure !== null && (
            <Notice tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}

          <div aria-live="polite">
            {current !== undefined && (
              <div className="flex flex-col gap-5 motion-safe:animate-rise">
                <div className="flex flex-col gap-2">
                  <VerdictLine tone={graded(current)}>
                    {t(VERDICT[graded(current)])}
                  </VerdictLine>
                  {!current.result.correct && (
                    <p className="text-ink">
                      {t("drills.expected", { text: current.result.expected })}
                    </p>
                  )}
                  <p className="text-ink-soft">{current.result.explanation}</p>
                </div>
                <div>
                  <Button
                    variant="primary"
                    onClick={next}
                    icon={
                      current.result.retry === null ? undefined : (
                        <RotateCcw aria-hidden className="size-4" />
                      )
                    }
                  >
                    {current.result.retry === null
                      ? t("drills.next")
                      : t("drills.retry")}
                    {current.result.retry === null && (
                      <ArrowRight aria-hidden className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
