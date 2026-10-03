import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BookWord } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { getChapterWords, setWordKnown } from "@/lib/ipc";
import { SittingEnd, SittingFrame, SittingWait } from "./SittingParts";

/** How many words went one way so far, under the colour of its button. */
function Tally({
  dot,
  children,
}: {
  dot: string;
  children: string;
}): ReactNode {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-ink-soft">
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {children}
    </p>
  );
}

/** The key a choice answers to, shown on its button. */
function Key({ children }: { children: string }): ReactNode {
  return (
    <kbd
      aria-hidden
      className="grid h-6 min-w-6 place-items-center rounded-sm border border-line-strong bg-canvas px-1 font-sans text-xs font-medium text-ink-soft"
    >
      {children}
    </kbd>
  );
}

interface TriageRunProps {
  chapterId: string;
  /** To practising the words left to learn. */
  onPractise: () => void;
  /** Leaving, at any moment or from the summary. */
  onDone: () => void;
}

/**
 * The chapter's open words as cards, one at a time, to clear the list fast:
 * the word, its translations under it, and two keys. A (or ←) marks the word
 * as known, at once, so leaving keeps every mark; D (or →) leaves it to learn.
 * Z (or Backspace) goes back a word and takes its mark with it; Escape leaves.
 */
export function TriageRun({
  chapterId,
  onPractise,
  onDone,
}: TriageRunProps): ReactNode {
  const { t } = useTranslation();
  /** The words to go through, as they stood on the way in. */
  const [words, setWords] = useState<BookWord[] | null>(null);
  /** Whether each word gone through was marked as known, in order. */
  const [marks, setMarks] = useState<boolean[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  /** A mark is on its way to Rust: the keys wait for it. */
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    getChapterWords(chapterId)
      .then((found) => {
        if (live) {
          setWords(found.words.filter((word) => !word.done && !word.known));
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
  }, [chapterId]);

  const word = words?.[marks.length];

  /** Keeps the mark of `target` in Rust, then moves the cards. */
  const settle = async (
    target: BookWord,
    known: boolean,
    write: boolean,
    next: boolean[],
  ): Promise<void> => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setFailure(null);
    try {
      if (write) {
        await setWordKnown(target.id, known);
      }
      setMarks(next);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      busy.current = false;
    }
  };

  const decide = (known: boolean): void => {
    if (word !== undefined) {
      void settle(word, known, known, [...marks, known]);
    }
  };

  const undo = (): void => {
    const last = words?.[marks.length - 1];
    if (last !== undefined) {
      void settle(last, false, marks.at(-1) === true, marks.slice(0, -1));
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "a" || key === "arrowleft") {
        decide(true);
      } else if (key === "d" || key === "arrowright") {
        decide(false);
      } else if (key === "z" || key === "backspace") {
        undo();
      } else if (key === "escape") {
        onDone();
      } else {
        return;
      }
      event.preventDefault();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  });

  const undoButton = (
    <Button
      variant="ghost"
      size="sm"
      disabled={marks.length === 0}
      icon={<Key>Z</Key>}
      onClick={undo}
    >
      {t("books.chapter.undo")}
    </Button>
  );

  const body = (): ReactNode => {
    if (words === null) {
      return <SittingWait failure={failure} />;
    }
    if (word === undefined) {
      const left = marks.filter((known) => !known).length;
      const back = { label: t("books.refresh.back"), onChoose: onDone };
      return (
        <SittingEnd
          title={t("books.triage.summary")}
          lead={t("books.triage.knew", { count: marks.length - left })}
          rest={
            left > 0
              ? t("books.chapter.wordCount", { count: left })
              : t("books.triage.noneLeft")
          }
          first={
            left > 0
              ? { label: t("books.chapter.practise"), onChoose: onPractise }
              : back
          }
          other={left > 0 ? back : null}
          notice={marks.length > 0 ? undoButton : null}
        />
      );
    }
    const known = marks.filter(Boolean).length;
    return (
      <div className="grid h-full place-items-center px-10">
        <div className="flex w-full max-w-lg flex-col items-center gap-8">
          <div className="flex w-full justify-between px-2">
            <Tally dot="bg-known">
              {t("books.triage.known", { count: known })}
            </Tally>
            <Tally dot="bg-accent-strong">
              {t("books.triage.toLearn", { count: marks.length - known })}
            </Tally>
          </div>
          <div
            key={word.id}
            className="flex w-full flex-col items-center gap-3 rounded-xl bg-surface px-8 py-12 text-center shadow-card motion-safe:animate-rise"
          >
            <p className="text-sm text-ink-faint">
              {`${String(marks.length + 1)} / ${String(words.length)}`}
            </p>
            <h1 className="text-5xl font-semibold tracking-tight wrap-anywhere text-ink">
              {word.lemma}
            </h1>
            <p className="text-lead text-ink-soft">
              {word.translations.join(", ")}
            </p>
            <p className="text-sm text-ink-faint">
              {t("books.triage.times", { count: word.count })}
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-3">
            <Button
              variant="known"
              size="lg"
              aria-keyshortcuts="A ArrowLeft"
              icon={<Key>A</Key>}
              onClick={() => {
                decide(true);
              }}
            >
              {t("books.chapter.known")}
            </Button>
            <Button
              variant="learn"
              size="lg"
              aria-keyshortcuts="D ArrowRight"
              onClick={() => {
                decide(false);
              }}
            >
              {t("books.triage.unknown")}
              <Key>D</Key>
            </Button>
          </div>
          {undoButton}
          <div aria-live="polite">
            {failure !== null && (
              <Notice tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <SittingFrame
      leave={t("books.triage.leave")}
      progress={
        words === null ? null : { value: marks.length, total: words.length }
      }
      onClose={onDone}
    >
      {body()}
    </SittingFrame>
  );
}
