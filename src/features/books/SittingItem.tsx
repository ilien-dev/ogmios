import { useEffect, useRef, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { PracticeItem, SentencePart } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextInput } from "@/components/ui/TextInput";
import { VerdictLine } from "@/components/ui/Verdict";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { useReadAloud } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import { grade } from "@/lib/grade";
import { languageName } from "@/lib/text";
import { DisputeNote } from "./DisputeNote";
import type { DisputeState } from "./sittingRun";

/** Each piece with a key of its own: where it starts, and what it is. */
function placed(
  parts: SentencePart[],
): Array<{ key: string; part: SentencePart }> {
  return parts.map((part, index) => {
    const start = parts
      .slice(0, index)
      .reduce((length, earlier) => length + earlier.text.length, 0);
    return { key: `${String(start)}${part.marked ? "w" : "s"}`, part };
  });
}

/** The sentence as the book has it. */
function whole(parts: SentencePart[]): string {
  return parts.map((part) => part.text).join("");
}

/**
 * The English of a word as it is asked, to be read aloud. English → native
 * it is all there from the start: the word, then its sentence. Native →
 * English it is the answer, so there is none until the verdict shows it.
 */
function aloud(item: PracticeItem, answer: string | null): string | null {
  if (item.direction === "production") {
    return answer;
  }
  return item.context === null
    ? item.prompt
    : `${item.prompt}. ${whole(item.context)}`;
}

interface ContextProps {
  parts: SentencePart[];
  /** The word is the answer: a blank stands where it was. */
  blanked: boolean;
}

/**
 * The word's sentence from the book. The word stands out in it, or, when it
 * is what is being asked, a blank of one width stands in for it: how long
 * the word is says nothing.
 */
function Context({ parts, blanked }: ContextProps): ReactNode {
  const { t } = useTranslation();
  const word = (key: string, part: SentencePart): ReactNode =>
    blanked ? (
      <span
        key={key}
        data-blank
        className="mx-1 inline-block w-16 border-b border-ink-faint"
      >
        <span className="sr-only">{t("books.sitting.blank")}</span>
      </span>
    ) : (
      <mark
        key={key}
        className="rounded-sm bg-accent-soft px-1 font-medium text-ink"
      >
        {part.text}
      </mark>
    );
  return (
    <p className="text-lead text-ink-soft">
      {placed(parts).map(({ key, part }) =>
        part.marked ? word(key, part) : <span key={key}>{part.text}</span>,
      )}
      {!blanked && <SpeakButton text={whole(parts)} className="ml-1" />}
    </p>
  );
}

/**
 * An answer once it is checked, in practice or in the refresh: whether it
 * was right, what was asked for, and what comes after it.
 */
export interface Checked {
  correct: boolean;
  accepted: string[];
  step: unknown;
}

interface VerdictProps {
  result: Checked;
  /** The learner said "I don't know": the answer is shown, nothing judged. */
  unknown: boolean;
  /** The English answer, where there is one to hear. */
  heard: string | null;
}

function Verdict({ result, unknown, heard }: VerdictProps): ReactNode {
  const { t } = useTranslation();
  const miss = unknown ? t("books.sitting.shown") : t("books.sitting.wrong");
  // "I don't know" is no miss to mark: only a typed answer is right or wrong.
  const tone = unknown ? "neutral" : grade(result.correct, false);
  return (
    <div className="flex flex-col gap-2">
      <VerdictLine tone={tone}>
        {result.correct ? t("books.sitting.right") : miss}
        {result.correct && heard !== null && <SpeakButton text={heard} />}
      </VerdictLine>
      {!result.correct && (
        <p className="text-ink">
          {t("books.sitting.accepted", { text: result.accepted.join(", ") })}
          {heard !== null && <SpeakButton text={heard} className="ml-1" />}
        </p>
      )}
    </div>
  );
}

interface SittingItemProps<Result extends Checked> {
  /** The learner's first language: the other side of English. */
  nativeLang: string;
  item: PracticeItem;
  /** Checks an answer; an empty one says the learner does not know. */
  check: (answer: string) => Promise<Result>;
  /** "I know this" on the word; null where it is not offered. */
  know: (() => Promise<Result["step"]>) | null;
  /** How "I was right" on this word's answer is going; null before it. */
  dispute: DisputeState | null;
  /** A line about an earlier word, shown under this one. */
  notice: ReactNode;
  /** The answer was checked: this is its verdict. */
  onAnswered?: (result: Result) => void;
  /** "I was right" on the miss this verdict is about; null where no one asks. */
  onDispute: ((result: Result) => void) | null;
  /**
   * The sitting goes on to this: the learner has seen the verdict, or said
   * they know the word already.
   */
  onNext: (step: Result["step"]) => void;
}

/**
 * One word of a sitting, asked one way: type its translation, Enter to
 * check it, Enter again to go on. "I don't know" shows the answer instead.
 * The verdict shows at once, with what is accepted on a miss. "I know this"
 * takes the word out of practice for good, with no answer and no verdict.
 * After a typed miss, "I was right" asks Claude; going on does not wait for
 * its answer. The refresh before reading asks its words with this same form,
 * without those two: its words are done, and its misses stand.
 *
 * Its English is read aloud, never its other language: the word and its
 * sentence as they appear, or, asked for in English, the answer once the
 * verdict is out.
 */
export function SittingItem<Result extends Checked>({
  nativeLang,
  item,
  check,
  know,
  dispute,
  notice,
  onAnswered,
  onDispute,
  onNext,
}: SittingItemProps<Result>): ReactNode {
  const { t, i18n } = useTranslation();
  const [response, setResponse] = useState("");
  const [checking, setChecking] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const onward = useRef<HTMLButtonElement>(null);
  const toEnglish = item.direction === "production";
  const english = languageName("en", i18n.language);
  const native = languageName(nativeLang, i18n.language);
  const answer = toEnglish ? (result?.accepted[0] ?? null) : null;
  useReadAloud(aloud(item, answer));

  // The keyboard is always where the next Enter belongs.
  useEffect(() => {
    if (result === null) {
      field.current?.focus();
    } else {
      onward.current?.focus();
    }
  }, [result]);

  /** Sends an answer; an empty one says the learner does not know. */
  const send = async (text: string): Promise<void> => {
    if (checking || result !== null) {
      return;
    }
    setChecking(true);
    setFailure(null);
    try {
      const verdict = await check(text);
      setUnknown(text === "");
      setResult(verdict);
      onAnswered?.(verdict);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  /** The word is known already: it is never asked again, and the next comes. */
  const skip = async (known: () => Promise<Result["step"]>): Promise<void> => {
    if (checking || result !== null) {
      return;
    }
    setChecking(true);
    setFailure(null);
    try {
      onNext(await known());
    } catch (error) {
      setFailure(errorMessage(error));
      setChecking(false);
    }
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const text = response.trim();
    if (text !== "") {
      void send(text);
    }
  };

  // Only a typed miss can be stood by, and once: again if it could not be asked.
  const disputable =
    result !== null &&
    !result.correct &&
    !unknown &&
    (dispute === null || dispute.status === "failed");

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8 px-10 pt-10 pb-12 motion-safe:animate-rise">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink-faint capitalize">
          {t("books.sitting.direction", {
            from: toEnglish ? native : english,
            to: toEnglish ? english : native,
          })}
        </p>
        <h1 className="text-display font-semibold text-balance text-ink">
          {item.prompt}
          {!toEnglish && <SpeakButton text={item.prompt} className="ml-2" />}
        </h1>
        {item.context !== null && (
          <Context parts={item.context} blanked={toEnglish} />
        )}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label
          htmlFor="sitting-answer"
          className="text-sm font-medium text-ink"
        >
          {t("books.sitting.answer")}
        </label>
        <TextInput
          ref={field}
          id="sitting-answer"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={response}
          readOnly={result !== null}
          onChange={(event) => {
            setResponse(event.target.value);
          }}
        />
        {result === null && (
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={checking || response.trim() === ""}
            >
              {t("books.sitting.check")}
            </Button>
            <Button
              variant="ghost"
              disabled={checking}
              onClick={() => void send("")}
            >
              {t("books.sitting.dontKnow")}
            </Button>
            {know !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto self-center text-ink-faint"
                disabled={checking}
                onClick={() => void skip(know)}
              >
                {t("books.sitting.know")}
              </Button>
            )}
          </div>
        )}
      </form>

      {failure !== null && (
        <Notice tone="danger">{t("common.error", { message: failure })}</Notice>
      )}

      <div aria-live="polite">
        {result !== null && (
          <div className="flex flex-col gap-5 motion-safe:animate-rise">
            <Verdict result={result} unknown={unknown} heard={answer} />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                ref={onward}
                variant="primary"
                onClick={() => {
                  onNext(result.step);
                }}
              >
                {t("books.sitting.next")}
                <ArrowRight aria-hidden className="size-4" />
              </Button>
              {disputable && onDispute !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-ink-faint"
                  onClick={() => {
                    onDispute(result);
                    // The button goes; Enter still means "next".
                    onward.current?.focus();
                  }}
                >
                  {t("books.sitting.wasRight")}
                </Button>
              )}
            </div>
            {dispute !== null && <DisputeNote state={dispute} />}
          </div>
        )}
        {notice}
      </div>
    </section>
  );
}
