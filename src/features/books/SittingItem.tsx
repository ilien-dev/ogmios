import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  AnotherWord,
  KindReminder,
  Ladder,
  PracticeItem,
  SenseHint,
  SenseTip,
  SentencePart,
  ShownSentence,
  WordHint,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import {
  VERDICT_WASH,
  VerdictLine,
  VerdictRibbon,
} from "@/components/ui/Verdict";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { useReadAloud } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { chime, prime, verdictTone } from "@/lib/chime";
import { languageName } from "@/lib/text";
import { DisputeNote } from "./DisputeNote";
import type { DisputeState } from "./sittingRun";
import { Key } from "./TriageRun";
import {
  FRAME,
  MARK,
  PracticeBand,
  SOLID,
  VerbForms,
  toneOf,
} from "./PracticeBand";
import { kindLine, retryKey } from "./retryLine";
import { SenseHintCard, SenseTipLine } from "./SenseHelp";
import { NextArrow } from "./SittingParts";
import { Clue, Whole } from "./SittingClue";
import { Context, whole } from "./SentenceContext";

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
  otherKind?: KindReminder | null;
  /** No answer yet: the next step of a word written alike to another one. */
  ladder?: Ladder | null;
  /** Right only with its sentence: neither right nor a miss. */
  understood?: SenseTip | null;
  helped?: boolean;
  exact?: string | null;
  sentence?: ShownSentence | null;
}

/**
 * What a verdict says of a word right only with its sentence: understood,
 * not known. A word its tag could not tell apart comes back with its few
 * words, or, asked with its whole sentence from the start, simply later.
 */
function understoodLine(tip: SenseTip, t: TFunction): string {
  if (!tip.tied) {
    return t("books.sitting.understood");
  }
  return tip.short
    ? t("books.sitting.understoodTied")
    : t("books.sitting.understoodWhole");
}

/** What the verdict says in its ribbon, across the top of the card. */
function verdictWords(result: Checked, unknown: boolean, t: TFunction): string {
  const understood = result.understood ?? null;
  if (understood !== null) {
    return understoodLine(understood, t);
  }
  if (result.correct) {
    return t("books.sitting.right");
  }
  return unknown ? t("books.sitting.shown") : t("books.sitting.wrong");
}

interface VerdictProps {
  result: Checked;
  /** The English answer, where there is one to hear. */
  heard: string | null;
}

/** What comes under a verdict: what is accepted, and the form wanted. */
function Verdict({ result, heard }: VerdictProps): ReactNode {
  const { t } = useTranslation();
  const exact = result.exact ?? null;
  const understood = result.understood ?? null;
  if (understood !== null) {
    return (
      <div className="flex flex-col items-center gap-2">
        <SenseTipLine tip={understood} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <Presence>
        {result.accepted.length > 0 && (
          <Reveal key="accepted" as="p" className="text-ink">
            {t("books.sitting.accepted", { text: result.accepted.join(", ") })}
            <Presence>
              {heard !== null && (
                <Reveal key="heard" as="span" kind="fade">
                  <SpeakButton text={heard} className="ml-1" />
                </Reveal>
              )}
            </Presence>
          </Reveal>
        )}
      </Presence>
      <Presence>
        {exact !== null && (
          <Reveal key="exact" as="p" className="text-ink-soft">
            {t("books.sitting.exact")}{" "}
            <strong
              data-exact
              className="inline-block rounded-sm bg-partial-soft px-1.5 font-medium text-partial motion-safe:animate-point"
            >
              {exact}
            </strong>
          </Reveal>
        )}
      </Presence>
    </div>
  );
}

interface SittingItemProps<Result extends Checked> {
  /** The learner's first language: the other side of English. */
  nativeLang: string;
  item: PracticeItem;
  /**
   * Checks an answer; an empty one says the learner does not know. `second`
   * says it is the second try at a word that came in the wrong form,
   * `hinted` that the learner asked for a hint first, and `rung` the step a
   * word written alike to another one is on.
   */
  check: (
    answer: string,
    second: boolean,
    hinted: boolean,
    rung: number,
  ) => Promise<Result>;
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
 * A word written alike to another one in another sense climbs steps. The
 * other word's meaning is no answer yet: a card says which word that was
 * and, when they are different kinds, what each kind is. A miss after that
 * shows the sentence. Right with the sentence it was understood, not known:
 * the verdict says so, with what to look at next time.
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
  /** What came was a word of another kind from its root. */
  const [kind, setKind] = useState<KindReminder | null>(null);
  /** The step a word written alike to another one is on, from 0. */
  const [rung, setRung] = useState(0);
  /** On its steps: which word the answer was, and then its sentence. */
  const [sense, setSense] = useState<SenseHint | null>(null);
  const [steps, setSteps] = useState<SentencePart[] | null>(null);
  /** Asked with its few words: the step after shows its whole sentence. */
  const [short, setShort] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** The hint asked for, and how often: each time gives a little more. */
  const [clue, setClue] = useState<WordHint | null>(null);
  const [hints, setHints] = useState(0);
  const [hinting, setHinting] = useState(false);
  // Its own: while the last word leaves, two of these forms are on the screen.
  const fieldId = useId();
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

  // The keyboard is always where the next Enter belongs, from the commit that
  // shows the field: no key can land anywhere else.
  useLayoutEffect(() => {
    if (result === null) {
      field.current?.focus();
    } else {
      onward.current?.focus();
    }
  }, [result, again]);

  // A window that comes back to the front gives the keyboard to the field
  // again, unless the learner had put it somewhere else on purpose.
  useEffect(() => {
    const back = (): void => {
      if (result === null && document.activeElement === document.body) {
        field.current?.focus();
      }
    };
    window.addEventListener("focus", back);
    return () => {
      window.removeEventListener("focus", back);
    };
  }, [result]);

  /** Sends an answer; an empty one says the learner does not know. */
  const send = async (text: string): Promise<void> => {
    if (checking || result !== null) {
      return;
    }
    setChecking(true);
    setFailure(null);
    // Woken by this key or click: the verdict's sound comes after an await.
    prime();
    try {
      const verdict = await check(text, again, hints > 0, rung);
      if (verdict.again === true) {
        // Neither right nor a miss yet: one more try, heard as the middle.
        chime("partial");
        setAgain(true);
        const ladder = verdict.ladder ?? null;
        if (ladder !== null) {
          setRung(ladder.rung);
          setOther(false);
          setKind(null);
          if (ladder.hint !== null) {
            setSense(ladder.hint);
          }
          if (ladder.context !== null) {
            setSteps(ladder.context);
          }
          setShort(ladder.short);
          setResponse("");
          return;
        }
        const told = verdict.another ?? null;
        setOther(told !== null);
        setKind(verdict.otherKind ?? null);
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
      chime(verdictTone(verdict, text === ""));
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
  // Nor one understood only with its sentence: it was no miss.
  const understood = (result?.understood ?? null) !== null;
  const disputable =
    result !== null &&
    !result.correct &&
    !unknown &&
    !understood &&
    (dispute === null || dispute.status === "failed");
  // An answer put to "I was right" stands: its sentence is not called bad.
  const discardable = bad !== null && dispute === null && !understood;

  // Why the answer is none yet: the step of a word written alike, another
  // kind, or the form or the word the sentence does not want.
  const retry = (): string => {
    if (rung === 1) {
      return t("books.sitting.otherMeaning");
    }
    if (rung === 2) {
      // Straight from the word alone: its tag could not tell it apart.
      if (sense !== null) {
        return t("books.sitting.readSentence");
      }
      return short
        ? t("books.sitting.otherMeaningRead")
        : t("books.sitting.otherMeaningLook");
    }
    return (
      kindLine(kind, t, item.verbForm) ??
      t(retryKey(other, item.sentenceId !== null, toEnglish, item.verbForm))
    );
  };

  // The card is drawn in the colour of its kind of word, and a verb shows
  // every form it can be asked in, the one asked filled.
  const shade = toneOf(item.partOfSpeech);
  const from = toEnglish ? native : english;
  const to = toEnglish ? english : native;
  // "I don't know" is no miss to mark: only a typed answer is right or wrong.
  const tone = result === null ? null : verdictTone(result, unknown);
  // A word that comes with its sentence is read in it: the sentence is the
  // heading, and the word stands out inside it, never above it.
  const led = !toEnglish && item.context !== null;

  return (
    <section className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center gap-6 px-6 pt-4 pb-16 text-center nav:px-10">
      <form onSubmit={submit} className="flex w-full flex-col gap-3">
        <div
          data-card
          data-verdict={tone ?? undefined}
          className={cn(
            "flex flex-col overflow-hidden rounded-2xl border-2 bg-surface shadow-card transition-[box-shadow,background-color,border-color] duration-300 ease-out-expo focus-within:shadow-glow-book",
            FRAME[shade],
            tone !== null && VERDICT_WASH[tone],
          )}
        >
          <PracticeBand
            from={from}
            to={to}
            kind={item.partOfSpeech}
            pointed={rung > 0 && sense !== null}
            irregular={item.irregular}
          />
          <Presence>
            {result !== null && tone !== null && (
              <Reveal key="ribbon" kind="fade">
                <VerdictRibbon tone={tone}>
                  {verdictWords(result, unknown, t)}
                </VerdictRibbon>
              </Reveal>
            )}
          </Presence>
          <Presence>
            {item.verbForm !== null && (
              <Reveal key="forms" kind="fade">
                <VerbForms form={item.verbForm} />
              </Reveal>
            )}
          </Presence>
          <div className="flex flex-col items-center gap-4 px-14 pt-10 pb-8">
            {/* The speaker hangs beside the word, out of its width: the word
                alone is what is centred. A word wider than the card breaks at
                its syllables, with a hyphen, and anywhere if none fits. */}
            <h1
              lang={toEnglish ? nativeLang : "en"}
              className={cn(
                led
                  ? "sr-only"
                  : "relative font-display text-6xl font-light tracking-tight text-balance wrap-anywhere hyphens-auto text-ink nav:text-7xl",
              )}
            >
              {item.prompt}
              <Presence>
                {!toEnglish && (
                  <Reveal
                    key="toEnglish"
                    as="span"
                    kind="fade"
                    className="absolute top-1/2 left-full ml-3 -translate-y-1/2"
                  >
                    <SpeakButton text={item.prompt} />
                  </Reveal>
                )}
              </Presence>
            </h1>
            <Presence>
              {item.context !== null && (
                <Reveal key="context">
                  <Context
                    parts={item.context}
                    blanked={toEnglish}
                    mark={led ? SOLID[shade] : MARK[shade]}
                    lead={led}
                  />
                </Reveal>
              )}
              {item.nativeContext !== null && (
                <Reveal key="nativeContext">
                  <Context parts={item.nativeContext} blanked={false} native />
                </Reveal>
              )}
              {steps !== null && (
                <Reveal key="steps">
                  <Context parts={steps} blanked={false} />
                </Reveal>
              )}
            </Presence>
            <Presence>
              {sense !== null && result === null && (
                <Reveal key="sense" className="w-full">
                  <SenseHintCard hint={sense} />
                </Reveal>
              )}
            </Presence>
            <Presence>
              {clue !== null && result === null && (
                <Clue key="clue" clue={clue} blanked={toEnglish} />
              )}
            </Presence>
          </div>
          <label htmlFor={fieldId} className="sr-only">
            {t("books.sitting.answer")}
          </label>
          <div
            className={cn(
              "flex items-center gap-2 border-t border-line bg-raised py-2 pr-2 pl-6 transition-colors duration-300",
              tone !== null && tone !== "neutral" && "bg-transparent",
            )}
          >
            <input
              ref={field}
              id={fieldId}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t("books.sitting.answer")}
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
              className="h-11 min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint focus-visible:outline-none"
            />
            <Presence>
              {result === null && (
                <Reveal key="check" as="span" kind="fade" className="shrink-0">
                  <Button
                    type="submit"
                    variant="primaryBook"
                    className="disabled:border disabled:border-line-strong disabled:bg-surface disabled:text-ink-soft"
                    disabled={checking || response.trim() === ""}
                  >
                    {t("books.sitting.check")}
                  </Button>
                </Reveal>
              )}
            </Presence>
          </div>
        </div>
        <Presence>
          {result === null && again && (
            <Reveal key="again" className="flex justify-center">
              <VerdictLine tone="partial">{retry()}</VerdictLine>
            </Reveal>
          )}
        </Presence>
        <div className="relative">
          <Presence swap>
            {result === null && (
              <Reveal
                key="ways"
                kind="fade"
                className="flex flex-wrap items-center justify-center gap-2"
              >
                <Button
                  variant="secondary"
                  disabled={checking}
                  aria-keyshortcuts={t("books.sitting.dontKnowKey")}
                  onClick={() => void send("")}
                >
                  {t("books.sitting.dontKnow")}
                  <Key>{t("books.sitting.dontKnowKey")}</Key>
                </Button>
                <Presence>
                  {hint !== null && (
                    <Reveal key="hint" as="span" kind="fade">
                      <Button
                        variant="secondary"
                        disabled={checking || hinting || !canHint}
                        aria-keyshortcuts={t("books.sitting.hintKey")}
                        onClick={() => void help()}
                      >
                        {lettered
                          ? t("books.sitting.hintMore")
                          : t("books.sitting.hint")}
                        <Key>{t("books.sitting.hintKey")}</Key>
                      </Button>
                    </Reveal>
                  )}
                </Presence>
                <Presence>
                  {know !== null && (
                    <Reveal key="know" as="span" kind="fade">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={checking}
                        onClick={() => void skip(know)}
                      >
                        {t("books.sitting.know")}
                      </Button>
                    </Reveal>
                  )}
                </Presence>
              </Reveal>
            )}
          </Presence>
        </div>
      </form>

      <Presence>
        {failure !== null && (
          <Notice key="failure" tone="danger" className="w-full max-w-xl">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </Presence>

      <div aria-live="polite" className="w-full max-w-xl">
        <Presence>
          {result !== null && (
            <Reveal key="result" className="flex flex-col items-center gap-5">
              <Verdict result={result} heard={heard} />
              <Presence>
                {shown !== null && (
                  <Reveal key="shown">
                    <Whole
                      sentence={shown}
                      busy={checking}
                      onBad={
                        discardable ? () => void skip(() => bad(result)) : null
                      }
                    />
                  </Reveal>
                )}
              </Presence>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  ref={onward}
                  variant="primaryBook"
                  className="group"
                  onClick={() => {
                    onNext(result.step);
                  }}
                >
                  {t("books.sitting.next")}
                  <NextArrow />
                </Button>
                <Presence>
                  {disputable && onDispute !== null && (
                    <Reveal key="dispute" as="span" kind="fade">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onDispute(result);
                          // The button goes; Enter still means "next".
                          onward.current?.focus();
                        }}
                      >
                        {t("books.sitting.wasRight")}
                      </Button>
                    </Reveal>
                  )}
                </Presence>
              </div>
              <Presence>
                {dispute !== null && <DisputeNote key="note" state={dispute} />}
              </Presence>
            </Reveal>
          )}
        </Presence>
        <Presence>{notice}</Presence>
      </div>
    </section>
  );
}
