import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import type { BookWord, SentenceProgress } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { BigNumber } from "@/components/scene/Stats";
import { cn } from "@/lib/cn";
import { SentenceStock } from "./SentenceStock";

interface ChapterAsideProps {
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
  /**
   * The sentences its words are asked with are being prepared: nothing that
   * asks them starts until they are.
   */
  readying: boolean;
  /** How far the sentences stand, once their preparation says. */
  writing: SentenceProgress | null;
  onPractise: () => void;
  onRefresh: () => void;
}

/* Above the words the aside sits flush left; on a narrow window, centred. */
const ALIGN = "items-center sm:items-start";
const JUSTIFY = "justify-center sm:justify-start";

/** How far the words stand, and which way into them is on offer. */
function Actions(props: ChapterAsideProps): ReactNode {
  const { t } = useTranslation();
  const { open, ready, refreshable, readying, writing } = props;
  if (open) {
    return (
      <div className={cn("flex flex-col gap-3", ALIGN)}>
        <Button
          variant="primaryBook"
          size="lg"
          disabled={readying}
          onClick={props.onPractise}
        >
          {t("books.chapter.practise")}
        </Button>
        <SentenceStock readying={readying} writing={writing} />
      </div>
    );
  }
  if (ready) {
    return (
      <div className={cn("flex flex-col gap-4", ALIGN)}>
        <p className="flex items-center gap-2 text-lead font-medium text-accent-text">
          <CircleCheck aria-hidden className="size-5 animate-float" />
          {t("books.ready")}
        </p>
        <SentenceStock readying={readying && refreshable} writing={writing} />
        <div className={cn("flex flex-wrap gap-2", JUSTIFY)}>
          <Presence>
            {refreshable && (
              <Reveal key="refresh" as="span" kind="fade">
                <Button disabled={readying} onClick={props.onRefresh}>
                  {t("books.refresh.start")}
                </Button>
              </Reveal>
            )}
          </Presence>
          <Presence>
            {refreshable && (
              <Reveal key="practise" as="span" kind="fade">
                <Button disabled={readying} onClick={props.onPractise}>
                  {t("books.chapter.practise")}
                </Button>
              </Reveal>
            )}
          </Presence>
        </div>
      </div>
    );
  }
  return null;
}

function modeOf({ open, ready }: ChapterAsideProps): string {
  if (open) {
    return "open";
  }
  return ready ? "ready" : "alone";
}

/**
 * Over the words: how many are learned and the actions that follow from
 * where the chapter stands. The panel's head names the book and chapter.
 */
export function ChapterAside(props: ChapterAsideProps): ReactNode {
  const { t } = useTranslation();
  const { words, preparing, prepared } = props;
  const toLearn = words?.filter((word) => !word.known) ?? [];
  const learned = toLearn.filter((word) => word.done).length;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-5 text-center sm:text-left",
        ALIGN,
      )}
    >
      <Presence>
        {prepared && !preparing && toLearn.length > 0 && (
          <Reveal
            key="progress"
            kind="fade"
            className="flex w-full flex-col gap-3 rounded-xl glass px-5 py-4.5 text-left"
          >
            <p className="text-sm text-ink-soft">
              {t("books.chapter.learnedLabel")}
            </p>
            <BigNumber
              value={learned}
              unit={t("books.chapter.learnedOf", { count: toLearn.length })}
            />
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
