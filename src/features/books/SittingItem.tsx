import { useEffect, useRef, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type {
  AnotherWord,
  PracticeItem,
  SentencePart,
  ShownSentence,
  WordHint,
} from "@shared/domain";
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
import { PartOfSpeechTag } from "./PartOfSpeechTag";
import type { DisputeState } from "./sittingRun";
import { Key } from "./TriageRun";
import { VerbFormTag } from "./VerbFormTag";

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
 * An answer once it is checked, in practice, in the recall or in the
 * refresh: whether it was right, what was asked for, and what comes after
 * it. Asked with a sentence of the word's bank it says more: that the word
 * came in the wrong form and gets one more try, that it was right on that
 * try, the form the sentence has it in, and the sentence itself.
 */
export interface Checked {
  correct: boolean;
  accepted: string[];
  step: unknown;
  again?: boolean;
  another?: AnotherWord | null;
  helped?: boolean;
  exact?: string | null;
  sentence?: ShownSentence | null;
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
  const tone = unknown
    ? "neutral"
    : grade(result.correct, result.helped === true);
  const exact = result.exact ?? null;
  return (
    <div className="flex flex-col gap-2">
      <VerdictLine tone={tone}>
        {result.correct ? t("books.sitting.right") : miss}
      </VerdictLine>
      {result.accepted.length > 0 && (
        <p className="text-ink">
          {t("books.sitting.accepted", { text: result.accepted.join(", ") })}
          {heard !== null && <SpeakButton text={heard} className="ml-1" />}
        </p>
      )}
      {exact !== null && (
        <p className="text-ink-soft">
          {t("books.sitting.exact")}{" "}
          <strong
            data-exact
            className="inline-block rounded-sm bg-partial-soft px-1.5 font-medium text-partial motion-safe:animate-point"
          >
            {exact}
          </strong>
        </p>
      )}
    </div>
  );
}

interface ClueProps {
  clue: WordHint;
  /** The word is the answer: its sentence comes with a blank. */
  blanked: boolean;
}

/**
 * The hint the learner asked for: the sentence the word came without, and,
 * from the next one on, the answer letter by letter, a mark for each one
 * not given yet.
 */
function Clue({ clue, blanked }: ClueProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div data-hint className="flex flex-col gap-2 motion-safe:animate-rise">
      {clue.context !== null && (
        <Context parts={clue.context} blanked={blanked} />
      )}
      {clue.mask !== null && (
        <p className="text-ink-soft">
          <span className="sr-only">{t("books.sitting.hintIs")} </span>
          <span
            data-mask
            className="font-mono text-lead tracking-widest whitespace-pre text-ink"
          >
            {clue.mask}
          </span>
        </p>
      )}
    </div>
  );
}

interface WholeProps {
  sentence: ShownSentence;
  /** Calls the sentence bad; null where that is not offered. */
  onBad: (() => void) | null;
  busy: boolean;
}

/**
 * What says why an answer is none yet: another word for what was shown, the
 * word in a form its sentence does not have, or, asked on its own, in a form
 * that is not its base form.
 */
function retryKey(
  other: boolean,
  inSentence: boolean,
):
  | "books.sitting.otherWord"
  | "books.sitting.wrongForm"
  | "books.sitting.baseForm" {
  if (other) {
    return "books.sitting.otherWord";
  }
  return inSentence ? "books.sitting.wrongForm" : "books.sitting.baseForm";
}

/**
 * The sentence a word was asked with, once it is answered: whole, to read
 * and to hear, with what it says in the learner's language and where it is
 * from. A sentence that is wrong or odd can be called bad: it is never
 * asked with again, and the answer given to it does not count.
 */
function Whole({ sentence, onBad, busy }: WholeProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 border-l-2 border-line pl-4">
      <p className="text-lead text-ink">
        {sentence.text}
        <SpeakButton text={sentence.text} className="ml-1" />
      </p>
      <p className="text-ink-soft">{sentence.translation}</p>
      <p className="flex items-center gap-3 text-sm text-ink-faint">
        {sentence.book
          ? t("books.sitting.fromBook")
          : t("books.sitting.fromClaude")}
        {onBad !== null && (
          <button
            type="button"
            disabled={busy}
            onClick={onBad}
            className="rounded-sm underline-offset-4 hover:text-ink hover:underline"
          >
            {t("books.sitting.badSentence")}
          </button>
        )}
      </p>
    </div>
  );
}

interface SittingItemProps<Result extends Checked> {
  /** The learner's first language: the other side of English. */
  nativeLang: string;
  item: PracticeItem;
  /**
   * Checks an answer; an empty one says the learner does not know. `second`
   * says it is the second try at a word that came in the wrong form, and
   * `hinted` that the learner asked for a hint first.
   */
  check: (answer: string, second: boolean, hinted: boolean) => Promise<Result>;
  /**
   * The hint to this word once that many were asked for; null where no
   * hint is offered.
   */
  hint?: ((asked: number) => Promise<WordHint>) | null;
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
   * "This sentence is bad" on the answer this verdict is about: what comes
   * next once it is taken back. Null where it is not offered.
   */
  bad?: ((result: Result) => Promise<Result["step"]>) | null;
  /**
   * The sitting goes on to this: the learner has seen the verdict, or said
   * they know the word already.
   */
  onNext: (step: Result["step"]) => void;
}

/**
 * One word of a sitting, asked one way: type its translation, Enter to
 * check it, Enter again to go on. "I don't know" shows the answer instead.
 * The verdict shows at once, with what is accepted, right or not: the ones
 * the learner did not give stay in sight. "I know this"
 * takes the word out of practice for good, with no answer and no verdict.
 * After a typed miss, "I was right" asks Claude; going on does not wait for
 * its answer. The refresh before reading asks its words with this same form,
 * without those two: its words are done, and its misses stand.
 *
 * Both keys show on their buttons: Alt+N from the field is "I don't know".
 * The word is asked on its own, with the kind of word it is, and for a verb
 * asked in a sentence the form it has there: only one that
 * needs its sentence to be told from another sense shows it from the
 * start. "Hint", or Alt+H from the field, helps without giving the word
 * away: first the sentence the word came without, then how long the answer
 * is, then one more letter each time. A right answer given after any of
 * them is a helped one.
 *
 * A word asked with a sentence of its bank comes in the form that sentence
 * has it. Asked for in English, the word in another form is no answer yet:
 * an amber line says so and the field stays open for one more try, with
 * the sentence blanked if it was not there yet. Another English word for
 * what was shown is no answer yet either: it is right for what the learner
 * saw, so the line says another word is wanted, and the sentence comes with
 * the first letter of that word. Once it
 * is answered the sentence shows whole, with its translation.
 *
 * Its English is read aloud, never its other language: the word, with its
 * sentence when it shows from the start, or, asked for in English, the
 * answer once the verdict is out.
 */
export function SittingItem<Result extends Checked>({
  nativeLang,
  item,
  check,
  hint = null,
  know,
  dispute,
  notice,
  onAnswered,
  onDispute,
  bad = null,
  onNext,
}: SittingItemProps<Result>): ReactNode {
  const { t, i18n } = useTranslation();
  const [response, setResponse] = useState("");
  const [checking, setChecking] = useState(false);
  const [unknown, setUnknown] = useState(false);
  /** The word came in the wrong form: the next answer is the second try. */
  const [again, setAgain] = useState(false);
  /** What came was another word for what was shown, not the wrong form. */
  const [other, setOther] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** The hint asked for, and how often: each time gives a little more. */
  const [clue, setClue] = useState<WordHint | null>(null);
  const [hints, setHints] = useState(0);
  const [hinting, setHinting] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const onward = useRef<HTMLButtonElement>(null);
  const toEnglish = item.direction === "production";
  const english = languageName("en", i18n.language);
  const native = languageName(nativeLang, i18n.language);
  const shown = result?.sentence ?? null;
  const answer = toEnglish ? (result?.accepted[0] ?? null) : null;
  // Asked in a sentence, the answer is heard where it belongs.
  const heard = answer === null ? null : (shown?.text ?? answer);
  useReadAloud(aloud(item, heard));

  // The keyboard is always where the next Enter belongs.
  useEffect(() => {
    if (result === null) {
      field.current?.focus();
    } else {
      onward.current?.focus();
    }
  }, [result, again]);

  /** Sends an answer; an empty one says the learner does not know. */
  const send = async (text: string): Promise<void> => {
    if (checking || result !== null) {
      return;
    }
    setChecking(true);
    setFailure(null);
    try {
      const verdict = await check(text, again, hints > 0);
      if (verdict.again === true) {
        setAgain(true);
        const told = verdict.another ?? null;
        setOther(told !== null);
        if (told !== null) {
          // What tells the two words apart; hints that gave more stay.
          if (hints <= told.asked) {
            setClue(told.hint);
            setHints(told.asked + 1);
          }
        } else if (
          hint !== null &&
          hints === 0 &&
          item.context === null &&
          item.sentenceId !== null
        ) {
          // The form is the sentence's: asked without it, it shows now.
          setClue(await hint(0));
          setHints(1);
        }
        return;
      }
      setUnknown(text === "");
      setResult(verdict);
      onAnswered?.(verdict);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  const canHint =
    hint !== null && result === null && (clue === null || clue.more);
  /** The answer has started to show: the next hint is one more letter. */
  const lettered = clue !== null && clue.mask !== null;

  /** Asks for a hint: the first one, or the one after the last. */
  const help = async (): Promise<void> => {
    if (hint === null || !canHint || hinting || checking) {
      return;
    }
    setHinting(true);
    setFailure(null);
    try {
      setClue(await hint(hints));
      setHints(hints + 1);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setHinting(false);
      field.current?.focus();
    }
  };

  /** Goes on without a verdict: the word is known, or its sentence is bad. */
  const skip = async (next: () => Promise<Result["step"]>): Promise<void> => {
    if (checking) {
      return;
    }
    setChecking(true);
    setFailure(null);
    try {
      onNext(await next());
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
  // An answer put to "I was right" stands: its sentence is not called bad.
  const discardable = bad !== null && dispute === null;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8 px-10 pt-10 pb-12 motion-safe:animate-rise">
      <div className="flex flex-col gap-3">
        <p data-way className="text-sm font-medium text-ink-faint capitalize">
          <Trans
            i18nKey="books.sitting.directionFrom"
            values={{
              from: toEnglish ? native : english,
              to: toEnglish ? english : native,
            }}
            components={{
              from: <span data-from className="font-bold text-accent-text" />,
            }}
          />
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-display font-semibold text-balance text-ink">
            {item.prompt}
            {!toEnglish && <SpeakButton text={item.prompt} className="ml-2" />}
          </h1>
          {/* Shift+Tab from the answer still lands on leaving the practice. */}
          <PartOfSpeechTag kind={item.partOfSpeech} offTabPath />
          <VerbFormTag form={item.verbForm} />
        </div>
        {item.context !== null && (
          <Context parts={item.context} blanked={toEnglish} />
        )}
        {clue !== null && result === null && (
          <Clue clue={clue} blanked={toEnglish} />
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
          onKeyDown={(event) => {
            // By the key, not the letter: Option+H types another one on a Mac.
            if (event.altKey && event.code === "KeyH") {
              event.preventDefault();
              void help();
            } else if (event.altKey && event.code === "KeyN") {
              event.preventDefault();
              void send("");
            }
          }}
        />
        {result === null && again && (
          <VerdictLine tone="partial">
            {t(retryKey(other, item.sentenceId !== null))}
          </VerdictLine>
        )}
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
              aria-keyshortcuts={t("books.sitting.dontKnowKey")}
              onClick={() => void send("")}
            >
              {t("books.sitting.dontKnow")}
              <Key>{t("books.sitting.dontKnowKey")}</Key>
            </Button>
            {hint !== null && (
              <Button
                variant="ghost"
                disabled={checking || hinting || !canHint}
                aria-keyshortcuts={t("books.sitting.hintKey")}
                onClick={() => void help()}
              >
                {lettered
                  ? t("books.sitting.hintMore")
                  : t("books.sitting.hint")}
                <Key>{t("books.sitting.hintKey")}</Key>
              </Button>
            )}
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
            <Verdict result={result} unknown={unknown} heard={heard} />
            {shown !== null && (
              <Whole
                sentence={shown}
                busy={checking}
                onBad={discardable ? () => void skip(() => bad(result)) : null}
              />
            )}
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
