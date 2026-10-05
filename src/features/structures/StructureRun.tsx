import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  StructureItem,
  StructureResult,
  StructureSitting,
  StructureSummary,
  StructureWord,
} from "@shared/structures";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { TextArea } from "@/components/ui/TextArea";
import { Tooltip } from "@/components/ui/Tooltip";
import { GRADE_TEXT, VerdictLine } from "@/components/ui/Verdict";
import { TAG } from "@/features/books/PartOfSpeechTag";
import { Key } from "@/features/books/TriageRun";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { VERDICT_GRADE } from "@/lib/grade";
import {
  answerStructure,
  closeStructureSitting,
  dropStructureWord,
  getStructureSitting,
  startStructureSitting,
  structuresState,
} from "@/lib/ipc";
import { FormText } from "./FormText";
import { formOf, goalOf, sampleOf, topicName, usageOf } from "./structureText";

interface FormProps {
  item: StructureItem;
  /** The form is in sight: in the warm-up, or because it was asked for. */
  shown: boolean;
  /** Asks for it; null once the sentence is answered. */
  onShow: (() => void) | null;
}

/**
 * How the structure is built, to the right of where the learner writes. In
 * the warm-up it is there to read; after it, it has to be asked for, and a
 * sentence written with it in sight counts as right with help.
 */
function Form({ item, shown, onShow }: FormProps): ReactNode {
  const { t } = useTranslation();
  if (!shown) {
    return (
      <aside className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong p-5">
        <p className="text-sm text-ink-soft">{t("structures.form.hidden")}</p>
        {onShow !== null && (
          <Button
            size="sm"
            aria-keyshortcuts={t("structures.form.showKey")}
            onClick={onShow}
          >
            {t("structures.form.show")}
            <Key>{t("structures.form.showKey")}</Key>
          </Button>
        )}
      </aside>
    );
  }
  return (
    <aside className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-sm font-medium text-ink-faint">
        {t("structures.form.title")}
      </h2>
      <p className="text-lead font-semibold text-ink">
        <FormText form={formOf(item.structure, t)} />
      </p>
      <p className="text-ink-soft italic">{item.example}</p>
      <p className="text-sm text-ink-soft">{usageOf(item.structure, t)}</p>
    </aside>
  );
}

/**
 * The word a sentence is asked to use, in the colour of its kind. Asked, it
 * says what kind of word it is and what it means, for a learner who needs
 * reminding; a word nothing is known of says nothing.
 */
function AskedWord({ word }: { word: StructureWord }): ReactNode {
  const { t } = useTranslation();
  const kind =
    word.partOfSpeech === null || word.partOfSpeech === "other"
      ? null
      : word.partOfSpeech;
  const hint = [
    ...(kind === null ? [] : [t(`books.chapter.partOfSpeech.${kind}`)]),
    ...(word.translations.length === 0 ? [] : [word.translations.join(", ")]),
  ].join(" · ");
  const chip = cn(
    "rounded-sm px-2.5 py-1 text-base font-medium",
    kind === null ? TAG.expression : TAG[kind],
  );
  if (hint === "") {
    return (
      <span className={chip} lang="en">
        {word.english}
      </span>
    );
  }
  return (
    <Tooltip hint={hint} className={chip} lang="en" tabIndex={-1}>
      {word.english}
    </Tooltip>
  );
}

interface WritingProps {
  item: StructureItem;
  /** What the sentence written was worth; null until it is checked. */
  result: StructureResult | null;
  /** The sentence as it was sent. */
  sent: string;
  /** The form was asked for after the warm-up. */
  peeked: boolean;
  checking: boolean;
  /** No sentence is left after this one. */
  last: boolean;
  onCheck: (text: string) => void;
  onPeek: () => void;
  /** The word asked for will not fit: the sentence goes without it. */
  onDropWord: () => void;
  onNext: () => void;
}

/**
 * The sentence to write, on the left: what it must be, the word to use, the
 * field, and, once checked, what it was worth with a right way to say it.
 * With a word it is about nothing else, and a word that will not fit can be
 * dropped. Enter checks and then goes on; Alt+N is "I don't know".
 */
function Writing({
  item,
  result,
  sent,
  peeked,
  checking,
  last,
  onCheck,
  onPeek,
  onDropWord,
  onNext,
}: WritingProps): ReactNode {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const next = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (result !== null) {
      next.current?.focus();
    }
  }, [result]);

  const goal = goalOf(item.structure, t);
  const sample = sampleOf(item.structure, t);
  const tags = [
    t(`level.${item.level}`),
    ...(item.warm ? [t("structures.run.warm")] : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <p className="self-start rounded-sm border border-line px-2 py-0.5 text-sm font-medium text-ink-soft">
        {goal === "" ? item.name : <Tooltip hint={goal}>{item.name}</Tooltip>}
        {` · ${tags.join(" · ")}`}
      </p>
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold text-ink">
          {item.topic === null
            ? t("structures.run.askWord", { structure: item.name })
            : t("structures.run.ask", {
                structure: item.name,
                topic: topicName(item.topic, t),
              })}
        </h1>
        {goal !== "" && (
          <div className="flex flex-col gap-1">
            <p className="text-ink-soft">{goal}</p>
            <p className="text-sm text-ink-faint">
              {t("structures.run.like", { sample })}
            </p>
          </div>
        )}
      </div>
      {item.word !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            {t("structures.run.useWord")}
            <AskedWord word={item.word} />
            <span className="text-ink-faint">
              {t(`structures.run.source.${item.word.source}`)}
            </span>
          </p>
          {result === null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={checking}
              title={t("structures.run.dropWordHint")}
              onClick={onDropWord}
            >
              {t("structures.run.dropWord")}
            </Button>
          )}
        </div>
      )}
      {result === null ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onCheck(text);
          }}
        >
          <TextArea
            aria-label={t("structures.run.label")}
            placeholder={t("structures.run.placeholder")}
            rows={3}
            autoFocus
            spellCheck={false}
            lang="en"
            disabled={checking}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              // By the key, not the letter: Option+H types another on a Mac.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onCheck(text);
              } else if (event.altKey && event.code === "KeyN") {
                event.preventDefault();
                onCheck("");
              } else if (event.altKey && event.code === "KeyH") {
                event.preventDefault();
                onPeek();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={checking}>
              {checking
                ? t("structures.run.checking")
                : t("structures.run.check")}
              {!checking && <Key>{t("structures.run.checkKey")}</Key>}
            </Button>
            <Button
              variant="ghost"
              disabled={checking}
              aria-keyshortcuts={t("structures.run.skipKey")}
              onClick={() => {
                onCheck("");
              }}
            >
              {t("structures.run.skip")}
              <Key>{t("structures.run.skipKey")}</Key>
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-5" aria-live="polite">
          <div className="flex flex-col gap-2">
            <VerdictLine tone={VERDICT_GRADE[result.verdict]}>
              {t(`structures.verdict.${result.verdict}`)}
            </VerdictLine>
            <p className="text-ink-soft" lang="en">
              {sent === "" ? t("structures.run.nothing") : sent}
            </p>
            <p className="text-ink">{result.explanation}</p>
            {!result.usedWord && item.word !== null && sent !== "" && (
              <p className="text-sm text-partial">
                {t("structures.run.missingWord", { word: item.word.english })}
              </p>
            )}
            {peeked && result.verdict === "partial" && (
              <p className="text-sm text-partial">
                {t("structures.run.peeked")}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ink-faint">
              {t("structures.run.better")}
            </p>
            <p className="text-lead font-medium text-ink" lang="en">
              {result.better}
            </p>
          </div>
          <Button
            ref={next}
            variant="primary"
            className="self-start"
            onClick={onNext}
          >
            {last ? t("structures.run.seeSummary") : t("structures.run.next")}
            <Key>{t("structures.run.checkKey")}</Key>
          </Button>
        </div>
      )}
    </div>
  );
}

interface EndProps {
  summary: StructureSummary;
  names: ReadonlyMap<string, string>;
  starting: boolean;
  onAgain: () => void;
  onDone: () => void;
}

/** How a session ended, and the way into another: practising is never refused. */
function End({
  summary,
  names,
  starting,
  onAgain,
  onDone,
}: EndProps): ReactNode {
  const { t } = useTranslation();
  const again = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    again.current?.focus();
  }, []);

  const tallies = [
    ["right", summary.correct, t("structures.summary.correct")],
    ["partial", summary.partial, t("structures.summary.partial")],
    ["wrong", summary.wrong, t("structures.summary.wrong")],
  ] as const;
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-10">
      <div className="flex w-full max-w-lg flex-col gap-8 motion-safe:animate-rise">
        <header className="flex flex-col gap-2">
          <h1 className="text-display font-semibold text-ink">
            {t("structures.summary.title")}
          </h1>
          <p className="text-lead text-ink-soft">
            {t("structures.summary.lead", {
              count: summary.correct + summary.partial + summary.wrong,
            })}
          </p>
        </header>
        <dl className="flex gap-10">
          {tallies.map(([grade, count, label]) => (
            <div key={grade} className="flex flex-col">
              <dd
                className={cn(
                  "text-title font-semibold tabular-nums",
                  GRADE_TEXT[grade],
                )}
              >
                {count}
              </dd>
              <dt className="text-sm text-ink-soft">{label}</dt>
            </div>
          ))}
        </dl>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-ink-faint">
            {t("structures.summary.byStructure")}
          </h2>
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {summary.structures.map((each) => (
              <li key={each.key} className="flex items-center gap-4 px-2 py-3">
                <span className="min-w-0 flex-1 font-medium text-ink">
                  {names.get(each.key) ?? each.key}
                </span>
                <span className="w-24">
                  <ProgressBar
                    label={names.get(each.key) ?? each.key}
                    value={each.right}
                    total={each.total}
                  />
                </span>
                <span className="text-sm text-ink-faint tabular-nums">
                  {t("structures.summary.count", {
                    right: each.right,
                    total: each.total,
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-soft">
            {t("structures.summary.note")}
          </p>
        </section>
        <div className="flex gap-2">
          <Button
            ref={again}
            variant="primary"
            disabled={starting}
            onClick={onAgain}
          >
            {t("structures.summary.again")}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t("common.done")}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface StructureRunProps {
  sittingId: string;
  /** Back to the menu: the session was paused, or its summary was read. */
  onLeave: () => void;
  /** Another session like this one was started. */
  onAgain: (sittingId: string) => void;
}

/**
 * One session with the whole window: a sentence at a time, written on the
 * left with the form of its structure on the right, and under it, always,
 * the two ways out: pausing, to go on later, and finishing. Once finished it
 * says how each structure went.
 */
export function StructureRun({
  sittingId,
  onLeave,
  onAgain,
}: StructureRunProps): ReactNode {
  const { t } = useTranslation();
  const [sitting, setSitting] = useState<StructureSitting | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [result, setResult] = useState<StructureResult | null>(null);
  const [sent, setSent] = useState("");
  const [peeked, setPeeked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([getStructureSitting(sittingId), structuresState()])
      .then(([opened, state]) => {
        if (live) {
          setSitting(opened);
          setNames(
            new Map(state.structures.map((each) => [each.key, each.name])),
          );
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    return () => {
      live = false;
    };
  }, [sittingId]);

  /** Runs one step with the backend, showing why it failed if it does. */
  const run = async (step: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await step();
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  if (sitting === null) {
    return (
      <main className="grid h-full place-items-center px-10">
        {failure === null ? (
          <Spinner />
        ) : (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </main>
    );
  }

  if (sitting.summary !== null) {
    return (
      <main className="h-full">
        <End
          summary={sitting.summary}
          names={names}
          starting={busy}
          onAgain={() =>
            void run(async () => {
              const next = await startStructureSitting(
                sitting.structures,
                sitting.size,
                sitting.chapterId,
              );
              onAgain(next.id);
            })
          }
          onDone={onLeave}
        />
      </main>
    );
  }

  const { item } = sitting;
  const check = (text: string): void => {
    if (item === null || busy) {
      return;
    }
    const written = text.trim();
    void run(async () => {
      const judged = await answerStructure(
        sittingId,
        item.index,
        written,
        peeked,
      );
      setSent(written);
      setResult(judged);
    });
  };
  const dropWord = (): void => {
    if (item === null || busy) {
      return;
    }
    void run(async () => {
      setSitting(await dropStructureWord(sittingId, item.index));
    });
  };
  const next = (): void => {
    void run(async () => {
      setSitting(await getStructureSitting(sittingId));
      setResult(null);
      setSent("");
      setPeeked(false);
    });
  };
  /** Pauses the session, or finishes it and shows how it went. */
  const leave = (finished: boolean): void => {
    void run(async () => {
      await closeStructureSitting(sittingId, finished);
      // One with nothing written is not kept: there is nothing to show.
      if (finished && sitting.done + (result === null ? 0 : 1) > 0) {
        setSitting(await getStructureSitting(sittingId));
      } else {
        onLeave();
      }
    });
  };

  const answered = sitting.done + (result === null ? 0 : 1);
  return (
    <main className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-6 px-10">
        <div className="min-w-0 flex-1">
          <ProgressBar
            label={t("structures.run.progress")}
            value={answered}
            total={sitting.total}
          />
        </div>
        <p className="text-sm text-ink-faint tabular-nums">
          {t("structures.run.count", {
            current: Math.min(sitting.done + 1, sitting.total),
            total: sitting.total,
          })}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-10 py-8">
          {failure !== null && (
            <Notice tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}
          {item !== null && (
            <div className="grid grid-cols-5 items-start gap-10">
              <div className="col-span-3">
                <Writing
                  key={item.index}
                  item={item}
                  result={result}
                  sent={sent}
                  peeked={peeked && !item.warm}
                  checking={busy && result === null}
                  last={
                    answered >= sitting.total && result?.verdict !== "wrong"
                  }
                  onCheck={check}
                  onPeek={() => {
                    setPeeked(true);
                  }}
                  onDropWord={dropWord}
                  onNext={next}
                />
              </div>
              <div className="col-span-2">
                <Form
                  item={item}
                  shown={item.warm || peeked}
                  onShow={
                    result === null
                      ? () => {
                          setPeeked(true);
                        }
                      : null
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <footer className="flex shrink-0 gap-3 border-t border-line px-10 py-4">
        <Button
          disabled={busy}
          onClick={() => {
            leave(false);
          }}
        >
          {t("structures.run.pause")}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            leave(true);
          }}
        >
          {t("structures.run.finish")}
        </Button>
      </footer>
    </main>
  );
}
