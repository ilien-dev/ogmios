import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import type { Book } from "@shared/domain";
import type {
  DictationInfo,
  ListeningChapter,
  ListeningState,
  Pace,
  PaceStanding,
} from "@shared/listening";
import type { Navigate } from "@/app/routes";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { chapterName } from "@/features/books/chapterName";
import { useSpeech } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import {
  closeDictation,
  listBooks,
  listeningState,
  startDictation,
} from "@/lib/ipc";
import { formatBytes } from "@/lib/text";
import { PaceChoice } from "./PaceChoice";

/** The pace the learner understands, and how each one stands under it. */
function Standing({ state }: { state: ListeningState }): ReactNode {
  const { t } = useTranslation();
  const row = (standing: PaceStanding): ReactNode => {
    const name = t(`listening.pace.${standing.pace}`);
    return (
      <li key={standing.pace} className="flex items-center gap-4 px-2 py-3">
        <span className="flex w-28 shrink-0 items-center gap-2 font-medium text-ink">
          {name}
          {standing.held && (
            <CircleCheck
              role="img"
              aria-label={t("listening.standing.held")}
              className="size-4 text-accent-text"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <ProgressBar
            label={t("listening.standing.bar", { pace: name })}
            value={standing.sentences === 0 ? 0 : standing.right}
            total={standing.sentences === 0 ? 1 : standing.total}
          />
        </span>
        <span className="w-40 shrink-0 text-right text-sm text-ink-faint tabular-nums">
          {standing.sentences === 0
            ? t("listening.standing.none")
            : t("listening.standing.count", {
                count: standing.sentences,
                percent: Math.floor((standing.right * 100) / standing.total),
              })}
        </span>
      </li>
    );
  };
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-faint">
          {t("listening.understood.label")}
        </p>
        {state.understood === null ? (
          <>
            <p className="text-title font-semibold text-ink-soft">
              {t("listening.understood.none")}
            </p>
            <p className="text-sm text-ink-soft">
              {t("listening.understood.noneHint")}
            </p>
          </>
        ) : (
          <p className="text-display font-semibold text-accent-text">
            {t(`listening.pace.${state.understood}`)}
          </p>
        )}
      </div>
      <ul
        aria-label={t("listening.standing.title")}
        className="flex flex-col divide-y divide-line border-y border-line"
      >
        {[...state.standings].reverse().map(row)}
      </ul>
      <p className="text-sm text-ink-faint">{t("listening.standing.note")}</p>
    </section>
  );
}

interface OnChapterProps {
  on: ListeningChapter;
  books: readonly Book[];
  pace: Pace;
  busy: boolean;
  onPace: (pace: Pace) => void;
  onChapter: (chapterId: string) => void;
  onDictation: () => void;
  onListen: () => void;
}

/** The chapter the listening is on, and the two things to do with it. */
function OnChapter({
  on,
  books,
  pace,
  busy,
  onPace,
  onChapter,
  onDictation,
  onListen,
}: OnChapterProps): ReactNode {
  const { t } = useTranslation();
  const left = on.place > 0;
  return (
    <section className="flex flex-col gap-4">
      <Field id="listening-chapter" label={t("listening.chapter.label")}>
        <Select
          id="listening-chapter"
          value={on.chapter.id}
          onChange={(event) => {
            onChapter(event.target.value);
          }}
        >
          {books.map((book) => (
            <optgroup key={book.id} label={book.title}>
              {book.chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapterName(chapter, t)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        <li className="flex flex-wrap items-center gap-4 px-2 py-4">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-medium text-ink">
              {t("listening.dictation.title")}
            </span>
            <span className="text-sm text-ink-soft">
              {t("listening.dictation.hint")}
            </span>
          </span>
          <PaceChoice value={pace} onChange={onPace} />
          <Button variant="primary" disabled={busy} onClick={onDictation}>
            {t("listening.dictation.start")}
          </Button>
        </li>
        <li className="flex flex-wrap items-center gap-4 px-2 py-4">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-medium text-ink">
              {t("listening.listen.title")}
            </span>
            <span className="text-sm text-ink-soft tabular-nums">
              {left
                ? t("listening.listen.place", {
                    current: on.place + 1,
                    total: on.sentences,
                  })
                : t("listening.listen.fresh", { count: on.sentences })}
            </span>
          </span>
          <Button onClick={onListen}>
            {left
              ? t("listening.listen.continue")
              : t("listening.listen.start")}
          </Button>
        </li>
      </ul>
    </section>
  );
}

interface PausedProps {
  paused: readonly DictationInfo[];
  onContinue: (id: string) => void;
  onEnd: (id: string) => void;
}

/** The dictations left before their end. */
function Paused({ paused, onContinue, onEnd }: PausedProps): ReactNode {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-ink-faint">
        {t("listening.paused.title")}
      </h2>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {paused.map((sitting) => (
          <li key={sitting.id} className="flex items-center gap-3 px-2 py-3">
            <span className="min-w-0 flex-1 text-sm text-ink-soft tabular-nums">
              {t("listening.paused.progress", {
                done: sitting.done,
                total: sitting.total,
              })}
            </span>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onContinue(sitting.id);
              }}
            >
              {t("listening.paused.continue")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onEnd(sitting.id);
              }}
            >
              {t("listening.paused.end")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The words that escape the ear, and the ones the dictations bring back. */
function Escaping({ state }: { state: ListeningState }): ReactNode {
  const { t } = useTranslation();
  const chip =
    "rounded-full border border-line px-3 py-1 text-sm text-ink-soft";
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink-faint">
          {t("listening.missed.title")}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {state.missed.map((each) => (
            <li key={each.word} className={chip}>
              <span className="font-medium text-ink" lang="en">
                {each.word}
              </span>
              {` · ${t("listening.missed.times", { count: each.times })}`}
            </li>
          ))}
        </ul>
      </div>
      {state.reinforced.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-ink-faint">
            {t("listening.reinforced.title")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {state.reinforced.map((word) => (
              <li key={word} className={chip} lang="en">
                <span className="font-medium text-ink">{word}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-faint">
            {t("listening.reinforced.hint")}
          </p>
        </div>
      )}
    </section>
  );
}

interface ListeningMenuProps {
  /** The chapter to be on; null for the one opened last. */
  chapterId: string | null;
  navigate: Navigate;
}

/**
 * The menu of the listening: the pace understood, the chapter with its
 * dictation and its reading aloud, the dictations left unfinished and the
 * words that escape the ear. Without the voice it only offers to get it.
 */
export function ListeningMenu({
  chapterId,
  navigate,
}: ListeningMenuProps): ReactNode {
  const { t, i18n } = useTranslation();
  const { status, fetching, fetch } = useSpeech();
  const [state, setState] = useState<ListeningState | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  /** The pace picked for the next dictation; null for the one offered. */
  const [picked, setPicked] = useState<Pace | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      const [loaded, shelf] = await Promise.all([
        listeningState(chapterId),
        listBooks(),
      ]);
      // Before any chapter was opened, the first of the shelf is the one.
      const first = shelf[0]?.chapters[0]?.id;
      const shown =
        loaded.chapter === null && first !== undefined
          ? await listeningState(first)
          : loaded;
      if (live) {
        setState(shown);
        setBooks(shelf);
      }
    };
    load().catch((error: unknown) => {
      if (live) {
        setFailure(errorMessage(error));
      }
    });
    return () => {
      live = false;
    };
  }, [chapterId]);

  /** Runs one step with the backend, showing why it failed if it does. */
  const run = async (step: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await step();
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  const on = state?.chapter ?? null;
  const voiceless = status !== null && !status.downloaded;
  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-10 py-16">
        <header className="flex flex-col gap-3">
          <BackLink
            label={t("nav.book")}
            onClick={() => {
              navigate({ name: "books", bookId: null });
            }}
          />
          <h1 className="text-display font-semibold text-ink">
            {t("listening.title")}
          </h1>
          <p className="text-lead text-ink-soft">{t("listening.intro")}</p>
        </header>
        {failure !== null && (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
        {state === null && failure === null && <Spinner />}
        {voiceless && status !== null && (
          <section className="flex flex-col items-start gap-4">
            <Notice>{t("listening.voice.need")}</Notice>
            <Button
              variant="primary"
              disabled={fetching !== null}
              onClick={() => {
                fetch().catch((error: unknown) => {
                  setFailure(errorMessage(error));
                });
              }}
            >
              {fetching === null
                ? t("listening.voice.get", {
                    size: formatBytes(status.bytes, i18n.language),
                  })
                : t("listening.voice.getting", {
                    percent: Math.round(fetching * 100),
                  })}
            </Button>
          </section>
        )}
        {state !== null && !voiceless && (
          <>
            <Standing state={state} />
            {on === null ? (
              <section className="flex flex-col items-start gap-4">
                <Notice>{t("listening.noBook")}</Notice>
                <Button
                  onClick={() => {
                    navigate({ name: "books", bookId: null, shelf: true });
                  }}
                >
                  {t("listening.toBooks")}
                </Button>
              </section>
            ) : (
              <OnChapter
                on={on}
                books={books}
                pace={picked ?? state.pace}
                busy={busy}
                onPace={setPicked}
                onChapter={(next) => {
                  navigate({ name: "listening", chapterId: next });
                }}
                onDictation={() =>
                  void run(async () => {
                    const sitting = await startDictation(
                      on.chapter.id,
                      picked ?? state.pace,
                    );
                    navigate({ name: "listening", running: sitting.id });
                  })
                }
                onListen={() => {
                  navigate({ name: "listening", reading: on.chapter.id });
                }}
              />
            )}
            {state.paused.length > 0 && (
              <Paused
                paused={state.paused}
                onContinue={(id) => {
                  navigate({ name: "listening", running: id });
                }}
                onEnd={(id) =>
                  void run(async () => {
                    await closeDictation(id, true);
                    setState(await listeningState(on?.chapter.id ?? null));
                  })
                }
              />
            )}
            {state.missed.length > 0 && <Escaping state={state} />}
          </>
        )}
      </div>
    </main>
  );
}
