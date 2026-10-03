import { useEffect, useRef, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { SessionSize, SittingProgress } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { GRADE_TEXT } from "@/components/ui/Verdict";
import { cn } from "@/lib/cn";
import type { Grade } from "@/lib/grade";

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

interface SittingSizesProps {
  /** The sizes on offer, smallest first; the last one is every open word. */
  sizes: readonly SessionSize[];
  /** Starts a session of that many words; null for every open word. */
  onStart: (size: number | null) => void;
}

/**
 * How many words the session takes, each size with about how long it lasts.
 * Every open word is chosen already and "Start" holds the keyboard, so Enter
 * alone begins; the sizes are one Shift+Tab and the arrows away.
 */
export function SittingSizes({ sizes, onStart }: SittingSizesProps): ReactNode {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(ALL);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
  }, []);

  const start = (event: SyntheticEvent): void => {
    event.preventDefault();
    onStart(chosen === ALL ? null : Number(chosen));
  };

  return (
    <div className="grid h-full place-items-center px-10">
      <form
        onSubmit={start}
        className="flex w-full max-w-lg flex-col items-start gap-8 motion-safe:animate-rise"
      >
        <h1 className="text-display font-semibold text-ink">
          {t("books.sitting.size")}
        </h1>
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
