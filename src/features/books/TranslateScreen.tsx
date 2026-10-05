import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight, Trash2 } from "lucide-react";
import type {
  Chapter,
  Translation,
  TranslationAttempt,
  TranslationAttempts,
  TranslationDirection,
  TranslationParagraph,
} from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/errors";
import {
  closeAttempt,
  deleteAttempt,
  getAttempt,
  listAttempts,
  startAttempt,
} from "@/lib/ipc";
import { languageName } from "@/lib/text";
import { chapterName } from "./chapterName";
import { DetailRow, Summary } from "./TranslateDetail";
import { PastRow, WritingRow } from "./TranslateRows";
import { isWhole, useTranslationRun } from "./useTranslationRun";
import type { TranslationRun } from "./useTranslationRun";

const DIRECTIONS: readonly TranslationDirection[] = ["toNative", "toEnglish"];

/** "English → Spanish", or the other way, in the interface language. */
function useWay(direction: TranslationDirection, native: string): string {
  const { t, i18n } = useTranslation();
  const english = languageName("en", i18n.language);
  const [from, to] =
    direction === "toNative" ? [english, native] : [native, english];
  return t("books.sitting.direction", { from, to });
}

interface AttemptRowProps {
  attempt: TranslationAttempt;
  native: string;
  /** Goes on with it, or reads it once it is finished. */
  onOpen: () => void;
  /** Finishes a paused one without going on with it. */
  onEnd: () => void;
  /** Deletes it for good, once the learner has said so twice. */
  onDelete: () => void;
}

/** One attempt in the list: when, which way, how far, and what to do with it. */
function AttemptRow({
  attempt,
  native,
  onOpen,
  onEnd,
  onDelete,
}: AttemptRowProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const way = useWay(attempt.direction, native);
  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(attempt.startedAt));
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2 py-4">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium text-ink">{way}</span>
        <span className="text-sm text-ink-soft">
          {[
            when,
            t("books.translate.count", {
              done: attempt.done,
              total: attempt.total,
            }),
            attempt.finished
              ? t("books.translate.finishedTag")
              : t("books.translate.paused"),
          ].join(" · ")}
        </span>
      </span>
      {confirming ? (
        <>
          <span className="w-full text-sm text-ink">
            {t("books.translate.deleteConfirm")}
          </span>
          <Button size="sm" variant="danger" onClick={onDelete}>
            {t("books.deleteYes")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t("common.cancel")}
          </Button>
        </>
      ) : (
        <>
          {attempt.finished ? (
            <Button size="sm" onClick={onOpen}>
              {t("books.translate.view")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="primary" onClick={onOpen}>
                {t("books.translate.continue")}
              </Button>
              <Button size="sm" onClick={onEnd}>
                {t("books.translate.end")}
              </Button>
            </>
          )}
          <button
            type="button"
            aria-label={t("books.translate.delete")}
            title={t("books.translate.delete")}
            onClick={() => {
              setConfirming(true);
            }}
            className="grid size-8 place-items-center rounded-sm text-ink-faint hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </>
      )}
    </li>
  );
}

interface StartProps {
  chapterId: string;
  /** The learner's language, as the interface names it. */
  native: string;
  /** An attempt was started, or one of the list opened. */
  onOpen: (attempt: Translation) => void;
}

/**
 * Where a session begins: a new attempt in one direction, chosen here and
 * not inside it, or one of the attempts kept. A paused one is gone on with
 * or finished as it is; a finished one is read. Back into English is open
 * once a paragraph is whole the other way.
 */
function Start({ chapterId, native, onOpen }: StartProps): ReactNode {
  const { t } = useTranslation();
  const [found, setFound] = useState<TranslationAttempts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setFound(await listAttempts(chapterId));
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }, [chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one step that ends on an attempt to open, or on the list again. */
  const run = async (
    step: () => Promise<Translation | null>,
  ): Promise<void> => {
    setFailure(null);
    try {
      const attempt = await step();
      if (attempt === null) {
        await load();
      } else {
        onOpen(attempt);
      }
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  if (found === null) {
    return failure === null ? (
      <Spinner />
    ) : (
      <Notice tone="danger">{t("common.error", { message: failure })}</Notice>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      {failure !== null && (
        <Notice tone="danger">{t("common.error", { message: failure })}</Notice>
      )}
      <section className="flex flex-col gap-4">
        <p className="text-ink-soft">{t("books.translate.choose")}</p>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {DIRECTIONS.map((direction) => {
            const closed = direction === "toEnglish" && found.back === 0;
            return (
              <li key={direction}>
                <button
                  type="button"
                  disabled={closed}
                  onClick={() =>
                    void run(() => startAttempt(chapterId, direction))
                  }
                  className="group flex w-full items-center gap-4 px-2 py-4 text-left hover:bg-raised disabled:cursor-not-allowed hover:disabled:bg-transparent"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium text-ink group-disabled:text-ink-faint">
                      {t(`books.translate.${direction}.name`, {
                        language: native,
                      })}
                    </span>
                    <span className="text-sm text-ink-soft">
                      {closed
                        ? t("books.translate.toEnglish.none", {
                            language: native,
                          })
                        : t(`books.translate.${direction}.hint`, {
                            language: native,
                          })}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-enabled:group-hover:translate-x-0.5 group-enabled:group-hover:text-ink"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {found.attempts.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-medium text-ink">
            {t("books.translate.attempts")}
          </h2>
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {found.attempts.map((attempt) => (
              <AttemptRow
                key={attempt.id}
                attempt={attempt}
                native={native}
                onOpen={() => void run(() => getAttempt(attempt.id))}
                onEnd={() =>
                  void run(async () => {
                    await closeAttempt(attempt.id, true);
                    return null;
                  })
                }
                onDelete={() =>
                  void run(async () => {
                    await deleteAttempt(attempt.id);
                    return null;
                  })
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** How many paragraphs just translated stay in sight, when they fit. */
const PAST_SHOWN = 2;
/** A paragraph kept to be measured, or on its way out: not to be read. */
const OUT_OF_SIGHT = "pointer-events-none invisible absolute inset-x-0 top-0";
const LEAVING =
  "pointer-events-none absolute inset-x-0 bottom-full opacity-0 motion-safe:animate-lift";

interface BarProps {
  translation: Translation;
  native: string;
}

/** Which way the attempt goes, and how far it is. */
function Bar({ translation, native }: BarProps): ReactNode {
  const { t } = useTranslation();
  const way = useWay(translation.direction, native);
  const { current, paragraphs, total, finished } = translation;
  const done = paragraphs.filter(isWhole).length;
  const being = finished
    ? undefined
    : paragraphs.find((each) => each.index === current);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <span className="rounded-md border border-line bg-sunken px-3 py-1.5 text-sm font-medium text-ink">
        {way}
      </span>
      <div className="w-48">
        <ProgressBar
          label={t("books.translate.progress")}
          value={done}
          total={total}
        />
      </div>
      <span className="text-sm text-ink-faint tabular-nums">
        {being === undefined
          ? t("books.translate.count", { done, total })
          : t("books.translate.paragraph", { current: being.index + 1, total })}
      </span>
    </div>
  );
}

interface SessionProps {
  run: TranslationRun;
  native: string;
}

/**
 * A running attempt: the paragraph being translated, and above it the last
 * two translated, each with its score and its marks. The one being written
 * comes first: the ones above stay only while they fit over it, the older
 * one going first. When a paragraph is whole the next one comes in from
 * below, and the oldest in sight leaves upwards.
 */
function Session({ run, native }: SessionProps): ReactNode {
  const { t } = useTranslation();
  const { translation } = run;
  const { current, paragraphs, total, direction } = translation;
  const done = paragraphs.filter(isWhole);
  const being = paragraphs.find((each) => each.index === current);
  const recent = done.slice(-PAST_SHOWN);
  /** The one that left when the paragraph being written came in. */
  const [opened] = useState(done.length);
  const gone = done.length > opened ? done.at(-PAST_SHOWN - 1) : undefined;

  const box = useRef<HTMLDivElement>(null);
  const writing = useRef<HTMLLIElement>(null);
  const older = useRef<HTMLLIElement>(null);
  const newer = useRef<HTMLLIElement>(null);
  const [fit, setFit] = useState(PAST_SHOWN);
  const [, setResized] = useState(0);

  useEffect(() => {
    const resized = (): void => {
      setResized((times) => times + 1);
    };
    globalThis.addEventListener("resize", resized);
    return () => {
      globalThis.removeEventListener("resize", resized);
    };
  }, []);

  // Measured at every render, before it is painted: what is written, the
  // reviews that arrive and the window all change how much fits.
  useLayoutEffect(() => {
    let room =
      (box.current?.clientHeight ?? 0) - (writing.current?.offsetHeight ?? 0);
    let count = 0;
    for (const row of [newer.current, older.current]) {
      const height = row?.offsetHeight ?? 0;
      if (row === null || height > room) {
        break;
      }
      room -= height;
      count += 1;
    }
    setFit(count);
  });

  const past = (paragraph: TranslationParagraph, at: number): ReactNode => {
    const fromLast = recent.length - 1 - at;
    return (
      <PastRow
        key={paragraph.index}
        ref={fromLast === 0 ? newer : older}
        paragraph={paragraph}
        failure={run.unreviewed.get(paragraph.index) ?? null}
        onReviewAgain={() => {
          run.reviewAgain(paragraph.index);
        }}
        away={fromLast < fit ? undefined : OUT_OF_SIGHT}
      />
    );
  };

  return (
    <div
      ref={box}
      className="flex min-h-0 flex-1 flex-col justify-end overflow-x-hidden overflow-y-auto"
    >
      <ul className="relative flex flex-col border-t border-line">
        {gone !== undefined && (
          <PastRow
            key={`gone-${String(gone.index)}`}
            paragraph={gone}
            failure={null}
            onReviewAgain={() => {
              run.reviewAgain(gone.index);
            }}
            away={LEAVING}
          />
        )}
        {recent.map(past)}
        {being?.source === null && (
          <li
            ref={writing}
            className="flex flex-wrap items-center gap-3 border-b border-line py-6 text-ink-soft"
          >
            {run.unprepared ? (
              <>
                {t("books.translate.prepareFailed")}
                <Button size="sm" onClick={run.prepareAgain}>
                  {t("common.retry")}
                </Button>
              </>
            ) : (
              <>
                <Spinner />
                {t("books.translate.preparing", { language: native })}
              </>
            )}
          </li>
        )}
        {being !== undefined && being.source !== null && (
          <WritingRow
            key={being.index}
            ref={writing}
            paragraph={being}
            source={being.source}
            english={translation.direction === "toNative"}
            onWrite={(sentence, text) => run.write(being.index, sentence, text)}
          />
        )}
        {being === undefined && (
          <li
            ref={writing}
            className="flex flex-col gap-2 py-6 motion-safe:animate-enter"
          >
            <h2 className="text-lead font-semibold text-ink">
              {done.length === total
                ? t(
                    direction === "toNative"
                      ? "books.translate.finished"
                      : "books.translate.finishedBack",
                  )
                : t("books.translate.caughtUp")}
            </h2>
            <p className="text-ink-soft">
              {done.length === total
                ? t("books.translate.finishedHint")
                : t("books.translate.caughtUpHint", { language: native })}
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}

interface RunProps {
  /** The attempt as it stood when it was opened. */
  opened: Translation;
  native: string;
  /** The attempt was finished: it is opened again, to be read. */
  onFinished: (attempt: Translation) => void;
  /** The attempt was paused, or a finished one was read. */
  onLeave: () => void;
}

/**
 * One attempt on the screen. While it runs it is a session, with the two
 * ways out always under it: pausing, to go on later, and finishing. Once
 * finished it is read: a summary of what matters most, and then every
 * paragraph in full.
 */
function Run({ opened, native, onFinished, onLeave }: RunProps): ReactNode {
  const { t } = useTranslation();
  const run = useTranslationRun(opened);
  const { translation } = run;
  const [failure, setFailure] = useState<string | null>(null);
  const shown = failure ?? run.failure;
  const written = translation.paragraphs.some(
    (each) => each.written.length > 0,
  );

  /** Pauses the attempt, or finishes it and opens what it came to. */
  const leave = async (finished: boolean): Promise<void> => {
    try {
      await closeAttempt(translation.attemptId, finished);
      // One with nothing written is not kept: there is nothing to read.
      if (finished && written) {
        onFinished(await getAttempt(translation.attemptId));
      } else {
        onLeave();
      }
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  if (translation.finished) {
    return (
      <main className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-10 py-16">
          <header className="flex flex-col gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 self-start"
              icon={<ArrowLeft aria-hidden className="size-4" />}
              onClick={onLeave}
            >
              {t("books.translate.attempts")}
            </Button>
            <h1 className="text-display font-semibold text-ink">
              {t("books.translate.title")}
            </h1>
          </header>
          <Bar translation={translation} native={native} />
          {shown !== null && (
            <Notice tone="danger">
              {t("common.error", { message: shown })}
            </Notice>
          )}
          <Summary translation={translation} failure={run.unsummed} />
          <ul className="flex flex-col border-t border-line">
            {translation.paragraphs.filter(isWhole).map((paragraph) => (
              <DetailRow
                key={paragraph.index}
                paragraph={paragraph}
                failure={run.unreviewed.get(paragraph.index) ?? null}
                onReviewAgain={() => {
                  run.reviewAgain(paragraph.index);
                }}
                onPractise={(mark) => run.practise(paragraph.index, mark)}
              />
            ))}
          </ul>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-6 px-10 pt-10">
        <h1 className="text-title font-semibold text-ink">
          {t("books.translate.title")}
        </h1>
        <Bar translation={translation} native={native} />
        {shown !== null && (
          <Notice tone="danger">{t("common.error", { message: shown })}</Notice>
        )}
        <Session run={run} native={native} />
        <footer className="flex gap-3 border-t border-line py-4">
          <Button onClick={() => void leave(false)}>
            {t("books.translate.pause")}
          </Button>
          <Button onClick={() => void leave(true)}>
            {t("books.translate.finish")}
          </Button>
        </footer>
      </div>
    </main>
  );
}

interface TranslateScreenProps {
  chapter: Chapter;
  /** The learner's first language: what the chapter is translated into. */
  nativeLang: string;
  /** Back to the chapter. */
  onBack: () => void;
}

/**
 * Translating a chapter: into the learner's language, and then back into
 * English. It is done in attempts, each begun or picked up from the list
 * here; the direction of one holds until it is left.
 */
export function TranslateScreen({
  chapter,
  nativeLang,
  onBack,
}: TranslateScreenProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [opened, setOpened] = useState<Translation | null>(null);
  const native = languageName(nativeLang, i18n.language);

  if (opened !== null) {
    return (
      <Run
        key={`${opened.attemptId}-${String(opened.finished)}`}
        opened={opened}
        native={native}
        onFinished={setOpened}
        onLeave={() => {
          setOpened(null);
        }}
      />
    );
  }

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-10 py-16">
        <header className="flex flex-col gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 self-start"
            icon={<ArrowLeft aria-hidden className="size-4" />}
            onClick={onBack}
          >
            {chapterName(chapter, t)}
          </Button>
          <h1 className="text-display font-semibold text-ink">
            {t("books.translate.title")}
          </h1>
        </header>
        <Start chapterId={chapter.id} native={native} onOpen={setOpened} />
      </div>
    </main>
  );
}
