import { useEffect, useRef, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type {
  PracticeOptions,
  SessionSize,
  SittingProgress,
  Ways,
} from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { GRADE_TEXT } from "@/components/ui/Verdict";
import { cn } from "@/lib/cn";
import type { Grade } from "@/lib/grade";
import { languageName } from "@/lib/text";

interface SittingFrameProps {
  /** What the way out is called. */
  leave: string;
  /** How far the sitting is, as Rust says; null before its first word. */
  progress: SittingProgress | null;
  /** Leaving, at any moment: every answer given is already kept. */
  onClose: () => void;
  children: ReactNode;
}

/**
 * The whole window a sitting or a refresh has: across its top the bar that
 * says how far it is, and the way out. The bar has its place from the start,
 * so nothing moves when the first word brings it.
 */
export function SittingFrame({
  leave,
  progress,
  onClose,
  children,
}: SittingFrameProps): ReactNode {
  const { t } = useTranslation();
  return (
    <main className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-6 px-8">
        <div className="min-w-0 flex-1">
          {progress !== null && (
            <ProgressBar
              label={t("books.sitting.progress")}
              value={progress.value}
              total={progress.total}
            />
          )}
        </div>
        <button
          type="button"
          aria-label={leave}
          onClick={onClose}
          className="grid size-9 place-items-center rounded-md text-ink-faint hover:bg-raised hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </main>
  );
}

interface SittingWaitProps {
  /** Why the sitting could not start; null while it is starting. */
  failure: string | null;
}

/** A sitting, or a refresh, before its first word. */
export function SittingWait({ failure }: SittingWaitProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="grid h-full place-items-center px-10">
      {failure === null ? (
        <Spinner />
      ) : (
        <Notice tone="danger">{t("common.error", { message: failure })}</Notice>
      )}
    </div>
  );
}

/** How every open word is named among the sizes. */
const ALL = "all";

/** The words a direction has to ask: the last size is all of them. */
function wordsOf(sizes: readonly SessionSize[]): number {
  return sizes.at(-1)?.words ?? 0;
}

/** The size chosen until the learner picks one: the smallest on offer. */
function smallest(sizes: readonly SessionSize[]): string {
  const size = sizes.at(0)?.size ?? null;
  return size === null ? ALL : String(size);
}

/** Whether there is anything to choose before a session starts. */
export function hasChoice(options: PracticeOptions): boolean {
  const { sizes, oneWay } = options;
  return (
    sizes.length > 1 ||
    wordsOf(oneWay.recognition) > 0 ||
    wordsOf(oneWay.production) > 0
  );
}

interface SittingSizesProps {
  /** The sizes on offer, both ways and one way alone. */
  options: PracticeOptions;
  /** The learner's first language, named beside English on each way. */
  nativeLang: string;
  /** Starts a session of that many words, null for every one, in the ways. */
  onStart: (size: number | null, ways: Ways) => void;
}

/**
 * Which way the session asks and how many words it takes, each size with
 * about how long it lasts. Both ways and the smallest size are chosen already
 * and "Start" holds the keyboard, so Enter alone begins; the choices are one
 * Shift+Tab and the arrows away. A way with nothing left to ask is offered
 * all the same, as an extra review of every word, and says so once chosen;
 * only a chapter with no word to ask offers none.
 */
export function SittingSizes({
  options,
  nativeLang,
  onStart,
}: SittingSizesProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [ways, setWays] = useState<Ways>("both");
  const [chosen, setChosen] = useState(() => smallest(options.sizes));
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
  }, []);

  const start = (event: SyntheticEvent): void => {
    event.preventDefault();
    onStart(chosen === ALL ? null : Number(chosen), ways);
  };

  const english = languageName("en", i18n.language);
  const native = languageName(nativeLang, i18n.language);
  const offered: Record<Ways, readonly SessionSize[]> = {
    both: options.sizes,
    ...options.oneWay,
  };
  const labels: Record<Ways, string> = {
    both: t("books.sitting.waysBoth"),
    recognition: t("books.sitting.direction", { from: english, to: native }),
    production: t("books.sitting.direction", { from: native, to: english }),
  };
  const directions = (["both", "recognition", "production"] as const).filter(
    (each) => each === "both" || wordsOf(offered[each]) > 0,
  );
  const sizes = offered[ways];

  return (
    <div className="grid h-full place-items-center px-10">
      <form
        onSubmit={start}
        className="flex w-full max-w-lg flex-col items-start gap-8 motion-safe:animate-rise"
      >
        <h1 className="text-display font-semibold text-ink">
          {t("books.sitting.size")}
        </h1>
        {directions.length > 1 && (
          <div className="w-full">
            <ChoiceGroup
              legend={t("books.sitting.ways")}
              columns={3}
              size="sm"
              choices={directions.map((each) => ({
                value: each,
                label: labels[each],
              }))}
              value={ways}
              onChange={(next) => {
                // A size the other way may not have: back to its smallest.
                setWays(next);
                setChosen(smallest(offered[next]));
              }}
            />
            {options.extra.includes(ways) && (
              <p className="mt-2 text-sm text-ink-soft">
                {t("books.sitting.extra")}
              </p>
            )}
          </div>
        )}
        <div className="w-full">
          <ChoiceGroup
            legend={t("books.sitting.size")}
            hideLegend
            columns={2}
            choices={sizes.map(({ size, words, minutes }) => ({
              value: size === null ? ALL : String(size),
              label:
                size === null
                  ? t("books.sitting.sizeAll", { count: words })
                  : t("books.sitting.sizeWords", { count: words }),
              description: t("books.sitting.sizeMinutes", { count: minutes }),
            }))}
            value={chosen}
            onChange={setChosen}
          />
        </div>
        <Button ref={primary} type="submit" variant="primary">
          {t("books.sitting.start")}
        </Button>
      </form>
    </div>
  );
}

interface Choice {
  label: string;
  onChoose: () => void;
}

interface SittingEndProps {
  title: string;
  /** What was achieved, and under it what is left. */
  lead: string;
  rest: string;
  /** How each of the two went, where it is a result: it colours the line. */
  leadGrade?: Grade;
  restGrade?: Grade;
  /** The way on that holds the keyboard. */
  first: Choice;
  /** The other way out, when there are two. */
  other: Choice | null;
  /** A line about an answer given on the way. */
  notice?: ReactNode;
}

/** How a sitting or a refresh ended, and where to go from it. */
export function SittingEnd({
  title,
  lead,
  rest,
  leadGrade,
  restGrade,
  first,
  other,
  notice = null,
}: SittingEndProps): ReactNode {
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
  }, []);

  return (
    <div className="grid h-full place-items-center px-10">
      <div className="flex w-full max-w-lg flex-col gap-8 motion-safe:animate-rise">
        <h1 className="text-display font-semibold text-ink">{title}</h1>
        <div className="flex flex-col gap-2">
          <p
            className={cn(
              "text-lead",
              leadGrade === undefined ? "text-ink" : GRADE_TEXT[leadGrade],
            )}
          >
            {lead}
          </p>
          <p
            className={
              restGrade === undefined ? "text-ink-soft" : GRADE_TEXT[restGrade]
            }
          >
            {rest}
          </p>
        </div>
        <div className="flex gap-2">
          <Button ref={primary} variant="primary" onClick={first.onChoose}>
            {first.label}
          </Button>
          {other !== null && (
            <Button variant="ghost" onClick={other.onChoose}>
              {other.label}
            </Button>
          )}
        </div>
        <div aria-live="polite">{notice}</div>
      </div>
    </div>
  );
}
