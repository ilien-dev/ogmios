import { useEffect, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import type {
  RecallState,
  SentenceProgress,
  Strength,
  Ways,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Magnetic } from "@/components/motion/Magnetic";
import { Stagger } from "@/components/motion/Stagger";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { StatChip } from "@/components/scene/Stats";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/errors";
import { onSentenceProgress, recallState, writeSentences } from "@/lib/ipc";
import { languageName } from "@/lib/text";
import { SentenceStock } from "@/features/books/SentenceStock";
import { WordTowers } from "./WordTowers";
import { planTowers } from "./towers";

const WAYS = ["both", "recognition", "production"] as const;

/** The learned words of each strength. */
function counts(state: RecallState | null): Record<Strength, number> {
  return {
    new: state?.fresh ?? 0,
    settling: state?.settling ?? 0,
    firm: state?.firm ?? 0,
  };
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

/** What is due today and the way to start it, the panel along the scene. */
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
    <form
      onSubmit={start}
      className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl glass px-5.5 py-4"
    >
      <p className="flex-1 basis-60 font-display text-2xl font-light tracking-tight text-ink tabular-nums">
        {state.due > 0
          ? t("recall.due", { count: state.due })
          : t("recall.nothingDue")}
      </p>
      <Presence>
        {state.due > 0 && (
          <Reveal
            key="choose"
            className="flex flex-wrap items-center gap-x-5 gap-y-3"
          >
            <div className="min-w-0">
              <ChoiceGroup
                legend={t("books.sitting.ways")}
                hideLegend
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
            <div className="flex flex-wrap items-center gap-4">
              <Magnetic>
                <Button
                  type="submit"
                  variant="primaryBook"
                  disabled={readying}
                  className="group"
                  icon={
                    <Play
                      aria-hidden
                      className="size-4 transition-transform duration-300 ease-out-expo group-enabled:group-hover:scale-110"
                    />
                  }
                >
                  {t("recall.start")}
                </Button>
              </Magnetic>
              <SentenceStock readying={readying} writing={writing} />
            </div>
          </Reveal>
        )}
      </Presence>
    </form>
  );
}

/** How the daily review stands, and whether a run of it can start. */
export interface RecallToday {
  /** Null until read. */
  state: RecallState | null;
  /** Why it could not be read. */
  failure: string | null;
  /** The words' sentences are being prepared: the run waits for them. */
  readying: boolean;
  /** How far that is, once it says. */
  writing: SentenceProgress | null;
  /** Why the sentences could not be prepared; a run starts all the same. */
  unwritten: string | null;
}

/**
 * Reads how the daily review stands as its screen opens and, once its panel
 * shows (`shown`), prepares the sentences its words are asked with. The run
 * waits for them, so that it asks what an update brought. A failure lets it
 * start, and says so: a word without sentences yet is asked as it was
 * learned.
 */
export function useRecallToday(shown = true): RecallToday {
  const [state, setState] = useState<RecallState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [readying, setReadying] = useState(true);
  const [writing, setWriting] = useState<SentenceProgress | null>(null);
  const [unwritten, setUnwritten] = useState<string | null>(null);
  useEffect(() => {
    if (!shown) {
      return;
    }
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
  }, [shown]);

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

  return { state, failure, readying, writing, unwritten };
}

/** Every word in the daily review, whatever its strength. */
export function learnedCount(state: RecallState | null): number {
  return state === null ? 0 : state.fresh + state.settling + state.firm;
}

/**
 * The daily review on the column of glass: what is due today, how many
 * words it holds, and how it brings them back. How strong they are stands
 * on its towers.
 */
export function RecallBoard({
  state,
}: {
  state: RecallState | null;
}): ReactNode {
  const { t } = useTranslation();
  const learned = learnedCount(state);
  return (
    <Stagger className="flex flex-col gap-3.5">
      <Reveal className="flex flex-wrap gap-2">
        <StatChip value={state?.due ?? "–"} tone="accent">
          {t("recall.board.due")}
        </StatChip>
        <StatChip value={state === null ? "–" : learned}>
          {t("recall.board.learned", { count: learned })}
        </StatChip>
      </Reveal>
      <Reveal as="p" className="px-1 text-sm text-ink-faint">
        {t("recall.intro")}
      </Reveal>
    </Stagger>
  );
}

interface RecallSceneProps {
  recall: RecallToday;
  /** The learner's first language: the other side of English. */
  nativeLang: string;
  /** A run of the daily review, in these ways. */
  onStart: (ways: Ways) => void;
  /** The latest learned words of each strength, named beside its tower. */
  words?: Record<Strength, readonly string[]>;
  className?: string;
}

const NO_WORDS: Record<Strength, readonly string[]> = {
  new: [],
  settling: [],
  firm: [],
};

/**
 * The scene of the daily review: the words learned in the books and asked
 * for in conversations raised as towers by strength, a floor for every few
 * words and their latest named beside them, and along it the panel that says
 * how many are due today and starts the run of the day.
 */
export function RecallScene({
  recall,
  nativeLang,
  onStart,
  words = NO_WORDS,
  className,
}: RecallSceneProps): ReactNode {
  const { t } = useTranslation();
  const { state, failure, readying, writing, unwritten } = recall;
  const learned = learnedCount(state);
  const strengths = counts(state);
  return (
    <Scene
      label={t("recall.board.scene")}
      className={className}
      header={
        <>
          <SceneTitle>{t("recall.title")}</SceneTitle>
          <Presence>
            {learned > 0 && (
              <Reveal
                key="per"
                as="p"
                kind="fade"
                className="text-sm text-ink-faint"
              >
                {t("recall.towers.per", { count: planTowers(strengths).per })}
              </Reveal>
            )}
          </Presence>
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
        </>
      }
      footer={
        <div className="relative">
          <Presence swap>
            {state === null && failure === null && (
              <Reveal
                key="loading"
                as="span"
                kind="fade"
                className="inline-flex rounded-full glass p-3"
              >
                <Spinner />
              </Reveal>
            )}
            {state !== null && learned === 0 && (
              <Reveal
                key="empty"
                as="p"
                className="rounded-xl glass px-5.5 py-4.5 text-ink-soft"
              >
                {t("recall.empty")}
              </Reveal>
            )}
            {state !== null && learned > 0 && (
              <Reveal key="today">
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
        </div>
      }
    >
      <WordTowers
        counts={strengths}
        words={words}
        label={t("recall.board.relief", {
          fresh: strengths.new,
          settling: strengths.settling,
          firm: strengths.firm,
        })}
        className="size-full max-w-4xl px-6 pt-36 pb-44"
      />
    </Scene>
  );
}
