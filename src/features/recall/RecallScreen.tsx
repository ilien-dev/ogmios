import { useEffect, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  RecallState,
  SentenceProgress,
  Strength,
  Ways,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import type { Navigate } from "@/app/routes";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/errors";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { onSentenceProgress, recallState, writeSentences } from "@/lib/ipc";
import { languageName } from "@/lib/text";
import { RecallRun } from "./RecallRun";
import { StrengthMark } from "./StrengthMark";

const WAYS = ["both", "recognition", "production"] as const;

/** The learned words of each strength, weakest first. */
function counts(state: RecallState): Array<[Strength, number]> {
  return [
    ["new", state.fresh],
    ["settling", state.settling],
    ["firm", state.firm],
  ];
}

interface TodayProps {
  state: RecallState;
  nativeLang: string;
  /** The words' sentences are being prepared: the run waits for them. */
  readying: boolean;
  /** How far that is, once it says. */
  writing: SentenceProgress | null;
  onStart: (ways: Ways) => void;
}

/** What is due today and the way to start it, over how the words stand. */
function Today({
  state,
  nativeLang,
  readying,
  writing,
  onStart,
}: TodayProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [ways, setWays] = useState<Ways>("both");
  const english = languageName("en", i18n.language);
  const native = languageName(nativeLang, i18n.language);
  const labels: Record<Ways, string> = {
    both: t("books.sitting.waysBoth"),
    recognition: t("books.sitting.direction", { from: english, to: native }),
    production: t("books.sitting.direction", { from: native, to: english }),
  };
  const start = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (!readying) {
      onStart(ways);
    }
  };
  return (
    <>
      <form onSubmit={start} className="flex flex-col items-start gap-6">
        <p className="font-display text-title font-normal text-ink">
          {state.due > 0
            ? t("recall.due", { count: state.due })
            : t("recall.nothingDue")}
        </p>
        <Presence>
          {state.due > 0 && (
            <Reveal
              key="choose"
              className="flex w-full flex-col items-start gap-6"
            >
              <div className="w-full">
                <ChoiceGroup
                  legend={t("books.sitting.ways")}
                  columns={3}
                  size="sm"
                  choices={WAYS.map((each) => ({
                    value: each,
                    label: labels[each],
                  }))}
                  value={ways}
                  onChange={setWays}
                />
              </div>
              <Button type="submit" variant="primaryBook" disabled={readying}>
                {t("recall.start")}
              </Button>
              <Presence>
                {readying && (
                  <Reveal
                    key="readying"
                    aria-live="polite"
                    className="flex w-full flex-col gap-2"
                  >
                    <p className="flex items-center gap-2 text-sm text-ink-soft">
                      <Spinner />
                      {t("books.sentences.readying")}
                    </p>
                    <Presence>
                      {writing !== null && writing.total > 0 && (
                        <Reveal key="bar" kind="fade">
                          <ProgressBar
                            label={t("books.sentences.bar")}
                            value={writing.done}
                            total={writing.total}
                            tone="book"
                          />
                        </Reveal>
                      )}
                    </Presence>
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          )}
        </Presence>
      </form>
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink-faint">
          {t("recall.words")}
        </h2>
        <ul className="flex flex-wrap gap-x-8 gap-y-2">
          {counts(state).map(([strength, count]) => (
            <li
              key={strength}
              className="flex items-center gap-2 text-sm font-medium text-ink-soft"
            >
              <StrengthMark strength={strength} />
              {t(`recall.count.${strength}`, { count })}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

interface BetweenProps {
  nativeLang: string;
  onStart: (ways: Ways) => void;
}

/** The screen between runs: it reads how the recall stands as it opens. */
function Between({ nativeLang, onStart }: BetweenProps): ReactNode {
  const { t } = useTranslation();
  const [state, setState] = useState<RecallState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The run waits for the words' sentences, so that it asks what an update
  // brought. A failure lets it start, and says so: a word without sentences
  // yet is asked as it was learned.
  const [readying, setReadying] = useState(true);
  const [writing, setWriting] = useState<SentenceProgress | null>(null);
  const [unwritten, setUnwritten] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const unlisten = onSentenceProgress((heard) => {
      if (heard.chapterId === null && live) {
        setWriting(heard);
      }
    });
    writeSentences(null)
      .catch((error: unknown) => {
        if (live) {
          setUnwritten(errorMessage(error));
        }
      })
      .finally(() => {
        if (live) {
          setReadying(false);
        }
      });
    return () => {
      live = false;
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, []);

  useEffect(() => {
    let live = true;
    recallState()
      .then((loaded) => {
        if (live) {
          setState(loaded);
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
  }, []);

  const learned =
    state === null ? 0 : state.fresh + state.settling + state.firm;
  /** Names what the screen says: each of these comes in over the last. */
  const showing = (): string => {
    if (failure !== null) {
      return "failure";
    }
    if (state === null) {
      return "loading";
    }
    return learned === 0 ? "empty" : "today";
  };
  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-12 px-10 py-16">
        <header className="flex flex-col gap-3">
          <h1 className="font-display text-display font-light text-ink">
            {t("recall.title")}
          </h1>
          <p className="text-lead text-ink-soft">{t("recall.intro")}</p>
        </header>
        <div className="relative">
          <Presence swap>
            <Reveal key={showing()} className="flex flex-col gap-12">
              <Presence>
                {unwritten !== null && (
                  <Reveal key="unwritten">
                    <Notice tone="neutral">
                      {t("books.sentences.failed", { message: unwritten })}
                    </Notice>
                  </Reveal>
                )}
              </Presence>
              <Presence>
                {failure !== null && (
                  <Notice key="failure" tone="danger">
                    {t("common.error", { message: failure })}
                  </Notice>
                )}
              </Presence>
              <Presence>
                {state === null && failure === null && (
                  <Reveal key="loading" as="span" kind="fade">
                    <Spinner />
                  </Reveal>
                )}
              </Presence>
              <Presence>
                {state !== null && learned === 0 && (
                  <Reveal key="empty" as="p" className="text-ink-soft">
                    {t("recall.empty")}
                  </Reveal>
                )}
              </Presence>
              <Presence>
                {state !== null && learned > 0 && (
                  <Reveal key="today" className="flex flex-col gap-12">
                    <Today
                      state={state}
                      nativeLang={nativeLang}
                      readying={readying}
                      writing={writing}
                      onStart={onStart}
                    />
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          </Presence>
        </div>
      </div>
    </main>
  );
}

interface RecallScreenProps {
  /** The learner's first language: the other side of English. */
  nativeLang: string;
  /** The ways of the run on the screen; null between runs. */
  running: Ways | null;
  navigate: Navigate;
}

/**
 * The daily recall: the words learned in the books and asked for in
 * conversations come back here over the days, a few minutes at a time.
 * Between runs it says how many are due today and how strong the learned
 * words are; a run takes the whole window.
 */
export function RecallScreen({
  nativeLang,
  running,
  navigate,
}: RecallScreenProps): ReactNode {
  if (running !== null) {
    return (
      <RecallRun
        ways={running}
        nativeLang={nativeLang}
        onDone={() => {
          navigate({ name: "recall" });
        }}
      />
    );
  }
  return (
    <Between
      nativeLang={nativeLang}
      onStart={(ways) => {
        navigate({ name: "recall", running: ways });
      }}
    />
  );
}
