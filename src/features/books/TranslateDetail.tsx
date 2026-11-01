import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  Habit,
  ReviewMark,
  Translation,
  TranslationParagraph,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import {
  Learned,
  Marked,
  PROSE,
  ReviewState,
  SEVERITY_MARK,
  Score,
} from "./TranslateRows";

const LABEL = "text-xs font-semibold tracking-wide uppercase text-ink-faint";
const CHIP = "rounded-sm px-1 py-0.5 text-ink";

interface SummaryProps {
  translation: Translation;
  /** Why the summary could not be written; null while it can still arrive. */
  failure: string | null;
}

/**
 * What a finished attempt comes to, read before its paragraphs: its score,
 * the points that matter most, and the mistakes that came back.
 */
export function Summary({ translation, failure }: SummaryProps): ReactNode {
  const { t } = useTranslation();
  const { score, summary } = translation;
  // A summary is written from the errors alone: one left empty by slips
  // still has marks below it.
  const clean =
    summary !== null &&
    summary.points.length === 0 &&
    summary.habits.length === 0 &&
    translation.paragraphs.every(
      (paragraph) => (paragraph.review?.marks.length ?? 0) === 0,
    );
  return (
    <section className="flex flex-col gap-6 rounded-xl bg-surface p-6 shadow-card">
      <Presence>
        {score !== null && (
          <Reveal key="score" as="p" className="flex items-baseline gap-3">
            <Score score={score} />
            <span className="text-sm text-ink-soft">
              {t("books.translate.detail.overall")}
            </span>
          </Reveal>
        )}
      </Presence>
      <div className="relative">
        <Presence swap>
          {summary === null && failure === null && (
            <Reveal
              key="summarizing"
              kind="fade"
              className="flex items-center gap-2 text-ink-soft"
            >
              <Spinner />
              {t("books.translate.detail.summarizing")}
            </Reveal>
          )}
          {summary === null && failure !== null && (
            <Notice key="failed" tone="danger">
              {t("books.translate.detail.summaryFailed", { message: failure })}
            </Notice>
          )}
          {summary !== null && (
            <Reveal key="summary" kind="fade" className="flex flex-col gap-6">
              <Presence>
                {clean && (
                  <Reveal key="clean" as="p" className="text-correct">
                    {t("books.translate.detail.clean")}
                  </Reveal>
                )}
              </Presence>
              <Presence>
                {summary.points.length > 0 && (
                  <Reveal key="points" className="flex flex-col gap-2">
                    <h2 className={LABEL}>
                      {t("books.translate.detail.summary")}
                    </h2>
                    <ul className="flex max-w-prose list-disc flex-col gap-2 pl-5 text-ink">
                      {summary.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </Reveal>
                )}
              </Presence>
              <Presence>
                {summary.habits.length > 0 && (
                  <Reveal key="habits" className="flex flex-col gap-3">
                    <h2 className={LABEL}>
                      {t("books.translate.detail.habits")}
                    </h2>
                    <ul className="flex flex-col gap-4">
                      {summary.habits.map((habit) => (
                        <HabitItem key={habit.habit} habit={habit} />
                      ))}
                    </ul>
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          )}
        </Presence>
      </div>
    </section>
  );
}

/** A habit of the learner's, what to do about it and where it showed. */
function HabitItem({ habit }: { habit: Habit }): ReactNode {
  return (
    <li className="flex max-w-prose flex-col gap-1">
      <span className="font-medium text-ink">{habit.habit}</span>
      <span className="text-ink-soft">{habit.advice}</span>
      <Presence>
        {habit.examples.length > 0 && (
          <Reveal
            key="examples"
            as="span"
            kind="fade"
            className="flex flex-wrap gap-2 text-sm"
          >
            {habit.examples.map((example) => (
              <span key={example} className={cn(CHIP, SEVERITY_MARK.error)}>
                {example}
              </span>
            ))}
          </Reveal>
        )}
      </Presence>
    </li>
  );
}

interface MarkDetailProps {
  mark: ReviewMark;
  /** Adds the mark's word to the chapter's practice. */
  onPractise: () => Promise<void>;
}

/** One mark in full: what was written, what it should be, and why. */
function MarkDetail({ mark, onPractise }: MarkDetailProps): ReactNode {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const { word } = mark;

  const add = async (): Promise<void> => {
    setAdding(true);
    try {
      await onPractise();
    } finally {
      setAdding(false);
    }
  };

  return (
    <li className="flex flex-col items-start gap-1">
      <span className="text-ink">
        <span className={cn(CHIP, SEVERITY_MARK[mark.severity])}>
          {mark.fragment}
        </span>{" "}
        → {mark.better}
      </span>
      <span className="text-sm text-ink-soft">{mark.why}</span>
      <Presence>
        {word !== null && (
          <Reveal key="word" as="span" kind="fade">
            <Button
              size="sm"
              className="mt-1"
              disabled={word.inPractice || adding}
              onClick={() => void add()}
            >
              {word.inPractice
                ? t("books.translate.detail.added", { word: word.english })
                : t("books.translate.detail.add", { word: word.english })}
            </Button>
          </Reveal>
        )}
      </Presence>
    </li>
  );
}

interface DetailRowProps {
  paragraph: TranslationParagraph;
  failure: string | null;
  onReviewAgain: () => void;
  /** Adds the word of one of its marks to the chapter's practice. */
  onPractise: (mark: number) => Promise<void>;
}

/**
 * A paragraph of a finished attempt in full. On the right the English, and
 * under it what the learner wrote with its marks; on the left what the
 * review says of it: its score, what went well, and each mark explained.
 */
export function DetailRow({
  paragraph,
  failure,
  onReviewAgain,
  onPractise,
}: DetailRowProps): ReactNode {
  const { t } = useTranslation();
  const { review } = paragraph;
  return (
    <Reveal
      as="li"
      className="grid grid-cols-2 gap-x-10 rounded-xl bg-surface p-6 shadow-card"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <ReviewState
          review={review}
          failure={failure}
          onReviewAgain={onReviewAgain}
        />
        <Presence>
          {review !== null && review.good !== null && (
            <Reveal key="good" as="p" className="text-ink-soft">
              <span className="mr-2 text-xs font-semibold tracking-wide text-correct uppercase">
                {t("books.translate.detail.good")}
              </span>
              {review.good}
            </Reveal>
          )}
        </Presence>
        <Presence>
          {review?.marks.length === 0 && (
            <Reveal key="marks" as="p" className="text-correct">
              {t("books.translate.detail.none")}
            </Reveal>
          )}
        </Presence>
        <Presence>
          {review !== null && review.marks.length > 0 && (
            <Reveal key="marks" as="ul" className="flex flex-col gap-4">
              {review.marks.map((mark, at) => (
                // The marks of a review never change places.
                <MarkDetail
                  key={at}
                  mark={mark}
                  onPractise={() => onPractise(at)}
                />
              ))}
            </Reveal>
          )}
        </Presence>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className={LABEL}>{t("books.translate.detail.english")}</span>
          <p className={`${PROSE} text-ink-soft`}>
            <Learned sentences={paragraph.learned} />
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className={LABEL}>{t("books.translate.detail.yours")}</span>
          <p className={`${PROSE} text-ink`}>
            <Marked written={paragraph.written} review={review} />
          </p>
        </div>
      </div>
    </Reveal>
  );
}
