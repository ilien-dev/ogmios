import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BookWord, ChapterWords } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { errorMessage } from "@/lib/errors";
import {
  getChapterWords,
  restartSorting,
  setWordKnown,
  setWordSorted,
} from "@/lib/ipc";
import { SittingEnd, SittingFrame, SittingWait } from "./SittingParts";
import { Tally } from "./Tally";

/** The key a choice answers to, shown on its button. */
export function Key({ children }: { children: string }): ReactNode {
  return (
    <kbd
      aria-hidden
      className="grid h-6 min-w-6 place-items-center rounded-sm border border-line-strong bg-canvas px-1 font-sans text-xs font-medium text-ink-soft"
    >
      {children}
    </kbd>
  );
}

/** The words of the chapter still to learn: the ones a sorting goes through. */
function open(found: ChapterWords): BookWord[] {
  return found.words.filter((word) => !word.done && !word.known);
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
 * as known, D (or →) leaves it to learn, and each is kept at once: leaving
 * keeps every mark, and the next sorting starts at the first word that has
 * none. Z (or Backspace) goes back a word and takes its mark with it; Escape
 * leaves. A list gone through to its end offers another pass over the words
 * left to learn.
 */
export function TriageRun({
  chapterId,
  onPractise,
  onDone,
}: TriageRunProps): ReactNode {
  const { t } = useTranslation();
  /** The words to learn, as they stood on the way in or at the last pass. */
  const [words, setWords] = useState<BookWord[] | null>(null);
  /** Whether each word gone through this time was marked as known, in order. */
  const [marks, setMarks] = useState<boolean[]>([]);
  /** The words of the chapter already known when `words` was taken. */
  const [knownBefore, setKnownBefore] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  /** A mark is on its way to Rust: the keys wait for it. */
  const busy = useRef(false);

  /** Starts over from the chapter as Rust holds it. */
  const take = (found: ChapterWords): void => {
    setWords(open(found));
    setKnownBefore(found.words.filter((each) => each.known).length);
    setMarks([]);
  };

  useEffect(() => {
    let live = true;
    getChapterWords(chapterId)
      .then((found) => {
        if (live) {
          take(found);
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

  /** The words an earlier sorting left to learn: this one starts after them. */
  const before = words?.filter((each) => each.sorted).length ?? 0;
  const queue = words?.filter((each) => !each.sorted);
  const word = queue?.[marks.length];

  /** Has Rust keep a change, one at a time, then moves the cards. */
  const settle = async (
    write: () => Promise<ChapterWords>,
    move: (found: ChapterWords) => void,
  ): Promise<void> => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setFailure(null);
    try {
      move(await write());
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      busy.current = false;
    }
  };

  /** Keeps or takes back the mark of `target`: known, or left to learn. */
  const mark = (
    target: BookWord,
    known: boolean,
    on: boolean,
    next: boolean[],
  ): void => {
    void settle(
      () =>
        known ? setWordKnown(target.id, on) : setWordSorted(target.id, on),
      () => {
        setMarks(next);
      },
    );
  };

  const decide = (known: boolean): void => {
    if (word !== undefined) {
      mark(word, known, true, [...marks, known]);
    }
  };

  const undo = (): void => {
    const last = queue?.[marks.length - 1];
    if (last !== undefined) {
      mark(last, marks.at(-1) === true, false, marks.slice(0, -1));
    }
  };

  const again = (): void => {
    void settle(() => restartSorting(chapterId), take);
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

  const failed = failure !== null && (
    <Notice tone="danger">{t("common.error", { message: failure })}</Notice>
  );

  const body = (): ReactNode => {
    if (words === null) {
      return <SittingWait failure={failure} />;
    }
    const marked = marks.filter(Boolean).length;
    const known = knownBefore + marked;
    const left = before + marks.length - marked;
    if (word === undefined) {
      const back = { label: t("books.refresh.back"), onChoose: onDone };
      return (
        <SittingEnd
          title={t("books.triage.summary")}
          lead={
            marks.length > 0
              ? t("books.triage.knew", { count: known })
              : t("books.triage.finished")
          }
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
          notice={
            <div className="flex flex-col items-start gap-3">
              <div className="flex gap-2">
                {left > 0 && (
                  <Button variant="ghost" size="sm" onClick={again}>
                    {t("books.triage.again")}
                  </Button>
                )}
                {marks.length > 0 && undoButton}
              </div>
              {failed}
            </div>
          }
        />
      );
    }
    return (
      <div className="grid h-full place-items-center px-10">
        <div className="flex w-full max-w-lg flex-col items-center gap-8">
          <div className="flex w-full justify-between px-2">
            <Tally dot="bg-known">
              {t("books.triage.known", { count: known })}
            </Tally>
            <Tally dot="bg-accent-strong">
              {t("books.triage.toLearn", { count: left })}
            </Tally>
          </div>
          <div
            key={word.id}
            className="flex w-full flex-col items-center gap-3 rounded-xl bg-surface px-8 py-12 text-center shadow-card motion-safe:animate-rise"
          >
            <p className="text-sm text-ink-faint">
              {`${String(before + marks.length + 1)} / ${String(words.length)}`}
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
          <div aria-live="polite">{failed}</div>
        </div>
      </div>
    );
  };

  return (
    <SittingFrame
      leave={t("books.triage.leave")}
      progress={
        words === null
          ? null
          : { value: before + marks.length, total: words.length }
      }
      onClose={onDone}
    >
      {body()}
    </SittingFrame>
  );
}
