import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import type { Book, BookWord } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Orb } from "@/components/ui/Orb";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Reveal } from "@/components/motion/Reveal";
import { Presence } from "@/components/motion/Presence";

interface ChapterAsideProps {
  book: Book;
  /** The chapter's name, as the learner reads it. */
  name: string;
  /** Null until read. */
  words: BookWord[] | null;
  preparing: boolean;
  prepared: boolean;
  /** Some word is still to be practised. */
  open: boolean;
  /** Every word done or known, and the chapter is ready to read. */
  ready: boolean;
  /** The chapter is ready and has done words to go over once more. */
  refreshable: boolean;
  onPractise: () => void;
  onRefresh: () => void;
  onTranslate: () => void;
  onStructures: () => void;
}

/** How far the words stand, and which way into them is on offer. */
function Actions(props: ChapterAsideProps): ReactNode {
  const { t } = useTranslation();
  const { open, ready, refreshable } = props;
  if (open) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Button variant="primaryBook" size="lg" onClick={props.onPractise}>
          {t("books.chapter.practise")}
        </Button>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="learn" onClick={props.onTranslate}>
            {t("books.translate.start")}
          </Button>
          <Button variant="learn" onClick={props.onStructures}>
            {t("structures.chapter.open")}
          </Button>
        </div>
      </div>
    );
  }
  if (ready) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="flex items-center gap-2 text-lead font-medium text-accent-text">
          <CircleCheck aria-hidden className="size-5" />
          {t("books.ready")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Presence>
            {refreshable && (
              <Reveal key="refreshable" as="span" kind="fade">
                <Button onClick={props.onRefresh}>
                  {t("books.refresh.start")}
                </Button>
              </Reveal>
            )}
          </Presence>
          <Presence>
            {refreshable && (
              <Reveal key="refreshable" as="span" kind="fade">
                <Button onClick={props.onPractise}>
                  {t("books.chapter.practise")}
                </Button>
              </Reveal>
            )}
          </Presence>
          <Button onClick={props.onTranslate}>
            {t("books.translate.start")}
          </Button>
          <Button onClick={props.onStructures}>
            {t("structures.chapter.open")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Button onClick={props.onTranslate}>{t("books.translate.start")}</Button>
  );
}

function modeOf({ open, ready }: ChapterAsideProps): string {
  if (open) {
    return "open";
  }
  return ready ? "ready" : "alone";
}

/**
 * Beside the words: the warm orb, the book and the chapter, how many words are
 * learned and the actions that follow from where the chapter stands.
 */
export function ChapterAside(props: ChapterAsideProps): ReactNode {
  const { t } = useTranslation();
  const { book, name, words, preparing, prepared } = props;
  const toLearn = words?.filter((word) => !word.known) ?? [];
  const learned = toLearn.filter((word) => word.done).length;
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <Orb size="lg" section="book" shared />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-book">{book.title}</p>
        <h1 className="font-display text-title font-light text-ink">{name}</h1>
      </div>
      <Presence>
        {prepared && !preparing && toLearn.length > 0 && (
          <Reveal
            key="progress"
            kind="fade"
            className="flex w-full max-w-56 flex-col items-center gap-2"
          >
            <p className="text-sm text-ink-soft tabular-nums">
              {t("books.chapter.learnedCount", { count: learned })}
            </p>
            <ProgressBar
              label={t("books.chapter.learnedBar")}
              value={learned}
              total={toLearn.length}
              tone="book"
            />
          </Reveal>
        )}
      </Presence>
      <div className="relative">
        <Presence swap>
          {!preparing && words !== null && (
            <Reveal key={modeOf(props)} kind="fade">
              <Actions {...props} />
            </Reveal>
          )}
        </Presence>
      </div>
    </div>
  );
}
