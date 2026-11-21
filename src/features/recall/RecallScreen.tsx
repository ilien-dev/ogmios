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
import { StatChip, StatTile } from "@/components/scene/Stats";
import type { Navigate } from "@/app/routes";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/errors";
import { onSentenceProgress, recallState, writeSentences } from "@/lib/ipc";
import { languageName } from "@/lib/text";
import { SentenceStock } from "@/features/books/SentenceStock";
import { BarRelief } from "@/features/drills/BarRelief";
import { HubScreen } from "@/features/drills/ScreenParts";
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
      className="flex flex-col items-start gap-5 rounded-xl glass px-5.5 py-4.5"
    >
      <p className="font-display text-title font-light tracking-tight text-ink tabular-nums">
        {state.due > 0
          ? t("recall.due", { count: state.due })
          : t("recall.nothingDue")}
      </p>
      <Presence>
        {state.due > 0 && (
          <Reveal
            key="choose"
            className="flex w-full flex-col items-start gap-5"
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

/** How the learned words stand: one glass chip per strength, weakest first. */
function Strengths({ state }: { state: RecallState }): ReactNode {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 font-display text-base tracking-tight text-ink">
        {t("recall.words")}
      </h2>
      <Stagger as="ul" className="flex flex-wrap gap-2">
        {counts(state).map(([strength, count]) => (
          <Reveal
            as="li"
            key={strength}
            kind="scale"
            className="inline-flex h-9 items-center gap-2 rounded-full glass px-4 font-mono text-sm text-ink-soft tabular-nums"
          >
            <StrengthMark strength={strength} />
            {t(`recall.count.${strength}`, { count })}
          </Reveal>
        ))}
      </Stagger>
    </section>
  );
}

interface BetweenProps {
  nativeLang: string;
  onStart: (ways: Ways) => void;
}

/**
 * The screen between runs: it reads how the recall stands as it opens. The
 * words learned, by strength, are on the left; the scene raises them as
 * columns, and the panel along it starts the run of the day.
 */
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
  return (
    <HubScreen
      aside={
        <>
          <Reveal className="flex flex-wrap gap-2">
            <StatChip value={state?.due ?? "–"} tone="accent">
              {t("recall.board.due")}
            </StatChip>
            <StatChip value={state === null ? "–" : learned}>
              {t("recall.board.learned", { count: learned })}
            </StatChip>
          </Reveal>
          <Reveal className="grid grid-cols-2 gap-3">
            <StatTile
              icon={<StrengthMark strength="settling" />}
              label={t("recall.strength.settling")}
              value={state?.settling ?? 0}
            />
            <StatTile
              icon={<StrengthMark strength="firm" />}
              label={t("recall.strength.firm")}
              value={state?.firm ?? 0}
            />
          </Reveal>
          <Presence>
            {state !== null && learned > 0 && (
              <Reveal key="strengths">
                <Strengths state={state} />
              </Reveal>
            )}
          </Presence>
          <Reveal as="p" className="px-1 text-sm text-ink-faint">
            {t("recall.intro")}
          </Reveal>
        </>
      }
      scene={
        <Scene
          label={t("recall.board.scene")}
          className="flex-1"
          header={
            <>
              <SceneTitle>{t("recall.title")}</SceneTitle>
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
          <BarRelief
            label={t("recall.board.relief", {
              fresh: state?.fresh ?? 0,
              settling: state?.settling ?? 0,
              firm: state?.firm ?? 0,
            })}
            bars={(state === null ? [] : counts(state)).map(
              ([strength, count]) => ({
                key: strength,
                value: count,
                look: strength === "firm" ? "book" : "plain",
                tip: {
                  title: t(`recall.strength.${strength}`),
                  lines: [t("scene.tip.words", { count })],
                },
              }),
            )}
            className="size-full max-w-2xl px-6 pt-28 pb-72"
          />
        </Scene>
      }
    />
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
