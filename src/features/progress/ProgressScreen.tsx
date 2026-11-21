import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, CircleCheck } from "lucide-react";
import type { Progress, VocabEntry } from "@shared/domain";
import type { ListeningState } from "@shared/listening";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { MineTab, Navigate } from "@/app/routes";
import { KnownWords } from "@/features/books/KnownWords";
import { Standing } from "@/features/listening/Standing";
import {
  RecallBoard,
  RecallScene,
  learnedCount,
  useRecallToday,
} from "@/features/recall/RecallPanel";
import type { RecallToday } from "@/features/recall/RecallPanel";
import { wordsByStrength } from "@/features/recall/towers";
import { StrengthMark } from "@/features/recall/StrengthMark";
import {
  CatalogueBoard,
  CatalogueScene,
  useCatalogue,
} from "@/features/structures/StructureMenu";
import type { Catalogue } from "@/features/structures/StructureMenu";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import {
  getProgress,
  homeState,
  listKnownWords,
  listeningState,
} from "@/lib/ipc";
import { formatDate } from "@/lib/text";
import { focusPattern } from "./ladder";
import { MineTiles } from "./MineTiles";
import { ProgressBoard } from "./ProgressBoard";
import { ProgressScene } from "./ProgressScene";
import { TimeScene } from "./TimeScene";

function Section({
  title,
  empty,
  children,
  className,
}: {
  title: string;
  empty: string | null;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <Reveal
      as="section"
      className={cn("flex flex-col gap-5 rounded-xl glass p-6", className)}
    >
      <h2 className="font-display text-2xl font-light tracking-tight text-ink">
        {title}
      </h2>
      <Presence swap>
        {empty === null ? (
          <Reveal key="filled" kind="fade" index={0}>
            {children}
          </Reveal>
        ) : (
          <Reveal
            key="empty"
            as="p"
            kind="fade"
            index={0}
            className="text-ink-soft"
          >
            {empty}
          </Reveal>
        )}
      </Presence>
    </Reveal>
  );
}

/** Words shown before the learner asks for all of them. */
const VOCABULARY_SHOWN = 12;

/**
 * The words learned, the latest first: a few of them, and the rest on
 * request. A book brings them in by the hundred.
 */
function Vocabulary({ words }: { words: VocabEntry[] }): ReactNode {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shown = all ? words : words.slice(0, VOCABULARY_SHOWN);
  return (
    <div className="flex flex-col items-start gap-3">
      <dl className="flex w-full flex-col divide-y divide-line">
        <Presence>
          {shown.map((word, index) => (
            <Reveal
              key={`${word.date}-${word.english}-${word.asked ?? ""}`}
              kind="fade"
              index={index}
              className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0"
            >
              <dt className="flex items-center gap-2 font-medium text-ink">
                {word.english}
                <Presence>
                  {word.strength !== null && (
                    <Reveal key="strength" as="span" kind="fade">
                      <StrengthMark strength={word.strength} />
                    </Reveal>
                  )}
                </Presence>
              </dt>
              <dd className="truncate text-sm text-ink-faint">
                {word.asked ?? ""}
              </dd>
            </Reveal>
          ))}
        </Presence>
      </dl>
      <Presence>
        {shown.length < words.length && (
          <Reveal key="words" as="span" kind="fade">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3"
              onClick={() => {
                setAll(true);
              }}
            >
              {t("progress.vocabularyAll", { count: words.length })}
            </Button>
          </Reveal>
        )}
      </Presence>
    </div>
  );
}

/** What the time tab reads once it shows: the streak and how the ear stands. */
interface Heard {
  streak: number | null;
  listening: ListeningState | null;
}

/**
 * Read when the time tab first shows, and kept: neither changes while the
 * screen is up. Without them the tab still stands; it only shows less.
 */
function useHeard(enabled: boolean): Heard {
  const [streak, setStreak] = useState<number | null>(null);
  const [listening, setListening] = useState<ListeningState | null>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let live = true;
    homeState()
      .then((home) => {
        if (live) {
          setStreak(home.streak.days);
        }
      })
      .catch(() => null);
    listeningState()
      .then((state) => {
        if (live) {
          setListening(state);
        }
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [enabled]);
  return { streak, listening };
}

interface TabProps {
  tab: MineTab;
  progress: Progress;
  recall: RecallToday;
  catalogue: Catalogue;
  heard: Heard;
}

interface BoardProps extends TabProps {
  /** The pattern picked on the staircase; null for the one in focus. */
  selected: string | null;
  onSelect: (id: string) => void;
}

/** Words named before the learner opens all of them. */
const LATEST_SHOWN = 4;
/** Words a tower of the daily review names beside it. */
const TOWER_SHOWN = 4;

/** The few words learned last, each with how strong it stands. */
function Latest({ words }: { words: VocabEntry[] }): ReactNode {
  return (
    <ul className="flex flex-col gap-2.5">
      <Presence>
        {words.slice(0, LATEST_SHOWN).map((word, index) => (
          <Reveal
            key={`${word.date}-${word.english}-${word.asked ?? ""}`}
            as="li"
            kind="fade"
            index={index}
            className="flex items-baseline gap-3"
          >
            <span className="font-medium text-ink">{word.english}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-faint">
              {word.asked ?? ""}
            </span>
            <Presence>
              {word.strength !== null && (
                <Reveal key="strength" as="span" kind="fade">
                  <StrengthMark strength={word.strength} />
                </Reveal>
              )}
            </Presence>
          </Reveal>
        ))}
      </Presence>
    </ul>
  );
}

/** A glass row that opens a sheet: its name, its count and an arrow. */
function SheetButton({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number | null;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3.5 rounded-xl glass px-5 py-4 text-left transition-control hover:shadow-lift"
    >
      <CircleCheck aria-hidden className="size-5.5 text-known" />
      <span className="flex-1 font-medium text-ink">{label}</span>
      <Presence>
        {count !== null && (
          <Reveal
            key="count"
            as="span"
            kind="fade"
            className="font-mono text-sm text-ink-soft tabular-nums"
          >
            {count}
          </Reveal>
        )}
      </Presence>
      <ChevronRight
        aria-hidden
        className="size-4 text-ink-faint transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5"
      />
    </button>
  );
}

/**
 * The words tab on the column of glass: how the daily review stands, the
 * words learned last, and two sheets: every word learned, and the words the
 * learner said they already know.
 */
function WordsBoard({
  progress,
  recall,
}: Pick<TabProps, "progress" | "recall">): ReactNode {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<"words" | "known" | null>(null);
  const [known, setKnown] = useState<number | null>(null);
  const wordsTitle = useId();
  const knownTitle = useId();
  const close = (): void => {
    setSheet(null);
  };

  useEffect(() => {
    let live = true;
    listKnownWords()
      .then((words) => {
        if (live) {
          setKnown(words.length);
        }
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, []);

  return (
    <Stagger className="flex flex-col gap-3.5">
      <Reveal>
        <RecallBoard state={recall.state} />
      </Reveal>
      <Section
        title={t("progress.latest")}
        empty={
          progress.vocabulary.length === 0
            ? t("progress.vocabularyEmpty")
            : null
        }
      >
        <div className="flex flex-col items-start gap-4">
          <Latest words={progress.vocabulary} />
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            icon={<ChevronRight aria-hidden className="size-4" />}
            onClick={() => {
              setSheet("words");
            }}
          >
            {t("progress.vocabularyOpen", {
              count: progress.vocabulary.length,
            })}
          </Button>
        </div>
      </Section>
      <Reveal>
        <SheetButton
          label={t("books.known.title")}
          count={known}
          onClick={() => {
            setSheet("known");
          }}
        />
      </Reveal>
      <Dialog
        open={sheet === "words"}
        placement="side"
        labelledBy={wordsTitle}
        onClose={close}
      >
        <h2
          id={wordsTitle}
          className="pr-12 font-display text-2xl font-light tracking-tight text-ink"
        >
          {t("progress.vocabulary")}
        </h2>
        <Vocabulary words={progress.vocabulary} />
      </Dialog>
      <Dialog
        open={sheet === "known"}
        placement="side"
        labelledBy={knownTitle}
        onClose={close}
      >
        <KnownWords sheet={{ headingId: knownTitle }} onCount={setKnown} />
      </Dialog>
    </Stagger>
  );
}

/** The time tab on the column of glass. */
function TimeBoard({
  progress,
  heard,
}: Pick<TabProps, "progress" | "heard">): ReactNode {
  const { t, i18n } = useTranslation();
  const cefr = progress.cefrHistory.at(-1);
  const locale = i18n.language;
  return (
    <Stagger className="flex flex-col gap-3.5">
      <Section
        title={t("progress.cefr")}
        empty={cefr === undefined ? t("progress.cefrEmpty") : null}
      >
        <div className="flex flex-col gap-4">
          <p className="font-display text-6xl leading-none font-light tracking-tight text-ink tabular-nums">
            {cefr?.cefr}
          </p>
          <ol className="flex flex-wrap gap-2">
            <Presence>
              {progress.cefrHistory.map((point, index) => (
                <Reveal
                  key={point.date}
                  as="li"
                  kind="fade"
                  index={index}
                  className="rounded-full glass px-3 py-1 font-mono text-xs text-ink-soft tabular-nums"
                >
                  {`${formatDate(point.date, locale)} · ${point.cefr}`}
                </Reveal>
              ))}
            </Presence>
          </ol>
          <p className="text-sm text-ink-soft">{t("progress.cefrNote")}</p>
        </div>
      </Section>
      <Presence>
        {heard.listening !== null && (
          <Reveal key="standing">
            <Standing state={heard.listening} />
          </Reveal>
        )}
      </Presence>
      <Section
        title={t("progress.best")}
        empty={
          progress.bestSentences.length === 0 ? t("progress.bestEmpty") : null
        }
      >
        <ul className="flex flex-col gap-5">
          <Presence>
            {progress.bestSentences.map((sentence) => (
              <Reveal
                key={`${sentence.date}-${sentence.text}`}
                as="li"
                kind="fade"
                index={0}
                className="flex flex-col gap-1 border-l-2 border-mint pl-4"
              >
                <p className="leading-relaxed text-ink">{sentence.text}</p>
                <p className="font-mono text-xs text-ink-faint">
                  {formatDate(sentence.date, locale)}
                </p>
              </Reveal>
            ))}
          </Presence>
        </ul>
      </Section>
    </Stagger>
  );
}

/** The column of glass of the tab on the screen, under the four tiles. */
function Board({
  tab,
  progress,
  recall,
  catalogue,
  heard,
  selected,
  onSelect,
}: BoardProps): ReactNode {
  switch (tab) {
    case "words":
      return <WordsBoard progress={progress} recall={recall} />;
    case "patterns":
      return (
        <ProgressBoard
          progress={progress}
          selected={selected}
          onSelect={onSelect}
        />
      );
    case "structures":
      return <CatalogueBoard catalogue={catalogue} />;
    default:
      return <TimeBoard progress={progress} heard={heard} />;
  }
}

interface StageProps extends TabProps {
  nativeLang: string;
  /** The pattern picked on the staircase; null for the one in focus. */
  selected: string | null;
  navigate: Navigate;
}

/** The scene of the tab on the screen. */
function Stage({
  tab,
  progress,
  recall,
  catalogue,
  heard,
  nativeLang,
  selected,
  navigate,
}: StageProps): ReactNode {
  switch (tab) {
    case "words":
      return (
        <RecallScene
          recall={recall}
          nativeLang={nativeLang}
          words={wordsByStrength(progress.vocabulary, TOWER_SHOWN)}
          onStart={(ways) => {
            navigate({ name: "recall", running: ways });
          }}
          className="flex-1"
        />
      );
    case "patterns":
      return (
        <ProgressScene
          progress={progress}
          shown={
            progress.patterns.find((pattern) => pattern.id === selected) ??
            focusPattern(progress.patterns)
          }
          className="flex-1"
        />
      );
    case "structures":
      return <CatalogueScene catalogue={catalogue} />;
    default:
      return (
        <TimeScene
          progress={progress}
          streak={heard.streak}
          className="flex-1"
        />
      );
  }
}

interface ProgressScreenProps {
  /** What of it is on the screen: its words, patterns, structures or time. */
  tab: MineTab;
  /** The learner's first language: the other side of English. */
  nativeLang: string;
  navigate: Navigate;
}

/**
 * Everything the learner has gathered, in one place: four tiles pick between
 * their words (with the daily review they come back in), the patterns of
 * their conversations, the catalogue of structures (with the way into a free
 * session) and the time spoken. Each has its column of glass and its scene;
 * levels live here and nowhere else.
 */
export function ProgressScreen({
  tab,
  nativeLang,
  navigate,
}: ProgressScreenProps): ReactNode {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const recall = useRecallToday(tab === "words");
  const catalogue = useCatalogue(navigate);
  const heard = useHeard(tab === "time");

  useEffect(() => {
    let live = true;
    getProgress()
      .then((loaded) => {
        if (live) {
          setProgress(loaded);
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

  const view = (): ReactNode => {
    if (progress === null) {
      return (
        <main className="grid h-full place-items-center">
          <Presence swap>
            {failure === null ? (
              <Reveal key="waiting" as="span" kind="fade">
                <Spinner />
              </Reveal>
            ) : (
              <Notice key="failure" tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            )}
          </Presence>
        </main>
      );
    }

    const shared = { tab, progress, recall, catalogue, heard };
    return (
      <main className="h-full overflow-y-auto">
        <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row">
          <div className="scrollbar-none flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md wide:overflow-y-auto wide:pb-2">
            <Reveal kind="fade" index={0}>
              <MineTiles
                tab={tab}
                counts={{
                  words: learnedCount(recall.state),
                  patterns: progress.patterns.length,
                  structures: catalogue.state?.structures.length ?? 0,
                  time: Math.round(progress.weeklyMinutes.at(-1)?.minutes ?? 0),
                }}
                onPick={(next) => {
                  navigate({ name: "progress", tab: next });
                }}
              />
            </Reveal>
            <div className="relative">
              <Swap as="div" id={tab}>
                <Board {...shared} selected={picked} onSelect={setPicked} />
              </Swap>
            </div>
          </div>
          <div className="relative flex min-h-160 min-w-0 flex-1 flex-col">
            <Swap as="div" id={tab} className="flex min-h-160 flex-1 flex-col">
              <Stage
                {...shared}
                nativeLang={nativeLang}
                selected={picked}
                navigate={navigate}
              />
            </Swap>
          </div>
        </div>
      </main>
    );
  };

  return (
    <Swap
      as="div"
      id={progress === null ? "loading" : "ready"}
      className="h-full"
    >
      {view()}
    </Swap>
  );
}
