import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  ParagraphReview,
  SentencePart,
  Severity,
  TranslationParagraph,
} from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TextArea } from "@/components/ui/TextArea";
import { GRADE_TEXT } from "@/components/ui/Verdict";
import { cn } from "@/lib/cn";
import type { Grade } from "@/lib/grade";

/** One paragraph across both panels: what is written, and what it is from. */
const ROW = "grid grid-cols-2 gap-x-10 border-b border-line py-6";
export const PROSE = "max-w-prose text-lead";
/** The marker: gold on the sentence being written, grey on those written. */
const MARKED = "rounded-sm box-decoration-clone py-0.5";
/** What a review marks: red on what is wrong, amber on a slip. */
export const SEVERITY_MARK: Record<Severity, string> = {
  error: "bg-wrong/25",
  slip: "bg-partial/30",
};

/** From this score a paragraph went well; from the other, half well. */
const GOOD_SCORE = 85;
const FAIR_SCORE = 60;

function scoreGrade(score: number): Grade {
  if (score >= GOOD_SCORE) {
    return "right";
  }
  return score >= FAIR_SCORE ? "partial" : "wrong";
}

interface ScoreProps {
  score: number;
}

/** What a paragraph, or an attempt, scores out of 100, in its colour. */
export function Score({ score }: ScoreProps): ReactNode {
  const { t } = useTranslation();
  return (
    <span
      aria-label={t("books.translate.score", { score })}
      className={`text-title font-semibold tabular-nums ${GRADE_TEXT[scoreGrade(score)]}`}
    >
      {score}
    </span>
  );
}

interface MarkedProps {
  /** What the learner wrote, a sentence each. */
  written: readonly string[];
  /** Null before the paragraph is reviewed: nothing is marked yet. */
  review: ParagraphReview | null;
}

/** What the learner wrote, with what the review found wrong marked in it. */
export function Marked({ written, review }: MarkedProps): ReactNode {
  if (review === null) {
    return written.join(" ");
  }
  return review.sentences.map((parts, sentence) => (
    // The sentences of a paragraph, and the parts of one, never change places.
    <span key={sentence}>
      {parts.map((part, at) => {
        const severity =
          part.mark === null ? undefined : review.marks[part.mark]?.severity;
        return severity === undefined ? (
          <span key={at}>{part.text}</span>
        ) : (
          <span
            key={at}
            data-severity={severity}
            className={cn(MARKED, SEVERITY_MARK[severity], "text-ink")}
          >
            {part.text}
          </span>
        );
      })}{" "}
    </span>
  ));
}

interface ReviewStateProps {
  review: ParagraphReview | null;
  /** Why the review could not be written; null while it can still arrive. */
  failure: string | null;
  onReviewAgain: () => void;
}

/** The score of a paragraph, or what stands in for it until it has one. */
export function ReviewState({
  review,
  failure,
  onReviewAgain,
}: ReviewStateProps): ReactNode {
  const { t } = useTranslation();
  if (review !== null) {
    return <Score score={review.score} />;
  }
  if (failure === null) {
    return (
      <span className="flex items-center gap-2 text-sm text-ink-faint">
        <Spinner />
        {t("books.translate.reviewing")}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-2 text-sm text-ink-faint">
      {t("books.translate.reviewFailed", { message: failure })}
      <Button size="sm" onClick={onReviewAgain}>
        {t("common.retry")}
      </Button>
    </span>
  );
}

interface PastRowProps {
  paragraph: TranslationParagraph;
  failure: string | null;
  onReviewAgain: () => void;
  /** It has no room, or it is on its way out: there, but not to be read. */
  away?: string;
  ref?: Ref<HTMLLIElement>;
}

/**
 * A paragraph just translated, still in sight above the one being written.
 * Its review is quick: on the left its score beside what the learner wrote,
 * red on what was wrong and amber on a slip. The detail waits for the end
 * of the attempt, so that nothing here asks to be read.
 */
export function PastRow({
  paragraph,
  failure,
  onReviewAgain,
  away,
  ref,
}: PastRowProps): ReactNode {
  return (
    <li
      ref={ref}
      aria-hidden={away === undefined ? undefined : true}
      className={cn(ROW, away)}
    >
      <div className="flex min-w-0 items-start gap-4">
        <div className="w-16 shrink-0">
          <ReviewState
            review={paragraph.review}
            failure={failure}
            onReviewAgain={onReviewAgain}
          />
        </div>
        <p className={`${PROSE} min-w-0 text-ink-soft`}>
          <Marked written={paragraph.written} review={paragraph.review} />
        </p>
      </div>
      <p className={`${PROSE} min-w-0 text-ink-faint`}>
        {(paragraph.source ?? []).join(" ")}
      </p>
    </li>
  );
}

/**
 * Sentences of the book with the words the learner has learned underlined:
 * a quiet dotted line, in the one colour that means "you learned this", so
 * that a word is met again where the author used it. Everything else stays
 * the plain text it was.
 */
export function Learned({
  sentences,
}: {
  sentences: readonly SentencePart[][];
}): ReactNode {
  const pieces: ReactNode[] = [];
  let plain = "";
  for (const [index, parts] of sentences.entries()) {
    plain += index > 0 ? " " : "";
    for (const part of parts) {
      if (part.marked) {
        pieces.push(
          plain,
          // The marked words of a text never change places.
          <span
            key={pieces.length}
            data-learned
            className="underline decoration-learned decoration-dotted decoration-2 underline-offset-4"
          >
            {part.text}
          </span>,
        );
        plain = "";
      } else {
        plain += part.text;
      }
    }
  }
  return [...pieces, plain];
}

interface WritingRowProps {
  paragraph: TranslationParagraph;
  /** The sentences to translate: the paragraph is prepared. */
  source: readonly string[];
  /**
   * The source is the book's English: its learned words are underlined.
   * False back into English, where the English is the answer.
   */
  english: boolean;
  /** Keeps one sentence; whether it was kept. */
  onWrite: (sentence: number, text: string) => Promise<boolean>;
  ref?: Ref<HTMLLIElement>;
}

/**
 * The paragraph being translated, the only one on the screen: it comes in
 * from below when the one before it is whole. On the right the marker is on the sentence
 * to write, gold, and stays grey on the ones written; on the left the
 * learner writes it and Enter goes on to the next. No sentence is skipped: a
 * written one can be written again, and that is all.
 */
export function WritingRow({
  paragraph,
  source,
  english,
  onWrite,
  ref,
}: WritingRowProps): ReactNode {
  const { t } = useTranslation();
  /** A sentence already written that is being written again. */
  const [again, setAgain] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const at = again ?? paragraph.written.length;

  useEffect(() => {
    field.current?.focus();
  }, [at]);

  const submit = async (): Promise<void> => {
    if (busy || draft.trim() === "") {
      return;
    }
    setBusy(true);
    try {
      if (await onWrite(at, draft)) {
        setAgain(null);
        setDraft("");
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: SyntheticEvent): void => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const before = paragraph.written.slice(0, at);
  const after = paragraph.written.slice(at + 1);
  const rewrite = (offset: number, text: string): ReactNode => (
    <button
      key={offset}
      type="button"
      aria-label={t("books.translate.rewrite", { text })}
      className="mr-1 inline rounded-sm text-left hover:bg-raised"
      onClick={() => {
        setAgain(offset);
        setDraft(text);
      }}
    >
      {text}
    </button>
  );

  return (
    <li ref={ref} className={`${ROW} motion-safe:animate-enter`}>
      <div className="flex min-w-0 flex-col gap-3">
        {before.length > 0 && (
          <p className={`${PROSE} text-ink`}>
            {before.map((text, offset) => rewrite(offset, text))}
          </p>
        )}
        <form onSubmit={onSubmit} className="flex max-w-prose flex-col gap-2">
          <TextArea
            ref={field}
            rows={3}
            value={draft}
            aria-label={t("books.translate.sentence")}
            className="border-accent-strong bg-surface"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={onKeyDown}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink-faint">
              {t("books.translate.keys")}
            </span>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {t("books.translate.next")}
            </Button>
          </div>
        </form>
        {after.length > 0 && (
          <p className={`${PROSE} text-ink`}>
            {after.map((text, offset) => rewrite(at + 1 + offset, text))}
          </p>
        )}
      </div>
      <p className={`${PROSE} min-w-0 text-ink`}>
        {source.map((text, index) => {
          const written = index < paragraph.written.length && index !== at;
          const parts = english ? paragraph.learned[index] : undefined;
          const sentence =
            parts === undefined ? text : <Learned sentences={[parts]} />;
          // The sentences of a paragraph never change places.
          return (
            <span key={index}>
              {index === at ? (
                <mark className={cn(MARKED, "bg-accent/40 text-ink")}>
                  {sentence}
                </mark>
              ) : (
                <span
                  className={
                    written ? cn(MARKED, "bg-raised text-ink-faint") : undefined
                  }
                >
                  {sentence}
                </span>
              )}{" "}
            </span>
          );
        })}
      </p>
    </li>
  );
}
