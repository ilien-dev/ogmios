import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  StructureItem,
  StructureResult,
  StructureWord,
} from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { Tooltip } from "@/components/ui/Tooltip";
import { VerdictLine } from "@/components/ui/Verdict";
import { TAG } from "@/features/books/PartOfSpeechTag";
import { Key } from "@/features/books/TriageRun";
import { cn } from "@/lib/cn";
import { VERDICT_GRADE } from "@/lib/grade";
import { goalOf, sampleOf, topicName } from "./structureText";

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
  return (
    <Tooltip hint={hint} className={chip} lang="en" tabIndex={-1}>
      {word.english}
    </Tooltip>
  );
}

interface StructureWritingProps {
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
export function StructureWriting({
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
}: StructureWritingProps): ReactNode {
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

  const goal = goalOf(item.structure, t);
  const sample = sampleOf(item.structure, t);
  const tags = [
    t(`level.${item.level}`),
    ...(item.warm ? [t("structures.run.warm")] : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <p className="self-start rounded-full bg-surface px-3 py-1 text-sm font-medium text-ink-soft shadow-card">
        <Tooltip hint={goal}>{item.name}</Tooltip>
        {` · ${tags.join(" · ")}`}
      </p>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-title font-normal text-ink">
          {item.topic === null
            ? t("structures.run.askWord", { structure: item.name })
            : t("structures.run.ask", {
                structure: item.name,
                topic: topicName(item.topic, t),
              })}
        </h1>
        <Presence>
          {goal !== "" && (
            <Reveal key="goal" className="flex flex-col gap-1">
              <p className="text-ink-soft">{goal}</p>
              <p className="text-sm text-ink-faint">
                {t("structures.run.like", { sample })}
              </p>
            </Reveal>
          )}
        </Presence>
      </div>
      <Presence>
        {item.word !== null && (
          <Reveal key="word" className="flex flex-wrap items-center gap-3">
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              {t("structures.run.useWord")}
              <AskedWord word={item.word} />
              <span className="text-ink-faint">
                {t(`structures.run.source.${item.word.source}`)}
              </span>
            </p>
            <Presence>
              {result === null && (
                <Reveal key="drop" as="span" kind="fade">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={checking}
                    title={t("structures.run.dropWordHint")}
                    onClick={onDropWord}
                  >
                    {t("structures.run.dropWord")}
                  </Button>
                </Reveal>
              )}
            </Presence>
          </Reveal>
        )}
      </Presence>
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
                <TextArea
                  ref={field}
                  aria-label={t("structures.run.label")}
                  placeholder={t("structures.run.placeholder")}
                  rows={3}
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
                  <Button
                    type="submit"
                    variant="primaryBook"
                    disabled={checking}
                  >
                    {checking
                      ? t("structures.run.checking")
                      : t("structures.run.check")}
                    <Presence>
                      {!checking && (
                        <Reveal key="checking" as="span" kind="fade">
                          <Key>{t("structures.run.checkKey")}</Key>
                        </Reveal>
                      )}
                    </Presence>
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
                  {t(`structures.verdict.${result.verdict}`)}
                </VerdictLine>
                <p className="text-ink-soft" lang="en">
                  {sent === "" ? t("structures.run.nothing") : sent}
                </p>
                <p className="text-ink">{result.explanation}</p>
                <Presence>
                  {!result.usedWord && item.word !== null && sent !== "" && (
                    <Reveal key="sent" as="p" className="text-sm text-partial">
                      {t("structures.run.missingWord", {
                        word: item.word.english,
                      })}
                    </Reveal>
                  )}
                </Presence>
                <Presence>
                  {peeked && result.verdict === "partial" && (
                    <Reveal
                      key="partial"
                      as="p"
                      className="text-sm text-partial"
                    >
                      {t("structures.run.peeked")}
                    </Reveal>
                  )}
                </Presence>
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
                variant="primaryBook"
                className="self-start"
                onClick={onNext}
              >
                {last
                  ? t("structures.run.seeSummary")
                  : t("structures.run.next")}
                <Key>{t("structures.run.checkKey")}</Key>
              </Button>
            </Reveal>
          )}
        </Presence>
      </div>
    </div>
  );
}
