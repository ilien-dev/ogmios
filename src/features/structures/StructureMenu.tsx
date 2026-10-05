import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { Level } from "@shared/domain";
import type {
  ChapterStructures,
  StructureInfo,
  StructureSittingInfo,
  StructuresState,
} from "@shared/structures";
import type { Navigate } from "@/app/routes";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { chapterName } from "@/features/books/chapterName";
import { StrengthMark } from "@/features/recall/StrengthMark";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import {
  closeStructureSitting,
  startStructureSitting,
  structuresState,
} from "@/lib/ipc";
import { ScanProgress, useChapterScan } from "./ChapterScan";
import { StartBar } from "./StartBar";
import { DEFAULT_SIZE, formOf } from "./structureText";

const LEVELS: readonly Level[] = ["basic", "intermediate", "advanced"];

interface ChapterCardProps {
  found: ChapterStructures;
  names: ReadonlyMap<string, string>;
  /** To the chapter's structures, to practise them. */
  onOpen: () => void;
}

/**
 * The chapter the learner is on, and the structures it uses most. Until it
 * was read for them the card offers to read it, and does so in place, with
 * the reading in sight.
 */
function ChapterCard({
  found: stored,
  names,
  onOpen,
}: ChapterCardProps): ReactNode {
  const { t } = useTranslation();
  const scan = useChapterScan(stored.chapter.id);
  const found = scan.found ?? stored;
  return (
    <section className="flex flex-col items-start gap-4 rounded-lg border border-line bg-surface p-6 shadow-card">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-ink-faint">
          {t("structures.chapter.book", {
            book: found.bookTitle,
            chapter: chapterName(found.chapter, t),
          })}
        </p>
        <h2 className="text-lead font-semibold text-ink">
          {t("structures.chapter.title")}
        </h2>
      </header>
      {found.structures.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {found.structures.map((each) => (
            <li
              key={each.key}
              className="rounded-full border border-line bg-canvas px-3 py-1 text-sm text-ink-soft"
            >
              <span className="font-medium text-ink">
                {names.get(each.key) ?? each.key}
              </span>
              {" · "}
              {t("structures.chapter.count", { count: each.count })}
            </li>
          ))}
        </ul>
      )}
      {found.scanned && found.structures.length === 0 && (
        <p className="text-sm text-ink-soft">{t("structures.chapter.none")}</p>
      )}
      {scan.failure !== null && (
        <Notice tone="danger">
          {t("common.error", { message: scan.failure })}
        </Notice>
      )}
      {scan.reading && <ScanProgress progress={scan.progress} />}
      {!found.scanned && !scan.reading && (
        <>
          <p className="text-sm text-ink-soft">
            {t("structures.chapter.findHint")}
          </p>
          <Button variant="learn" onClick={scan.read}>
            {t("structures.chapter.find")}
          </Button>
        </>
      )}
      {found.structures.length > 0 && (
        <Button variant="learn" onClick={onOpen}>
          {t("structures.chapter.practise")}
        </Button>
      )}
    </section>
  );
}

interface PausedRowProps {
  sitting: StructureSittingInfo;
  names: ReadonlyMap<string, string>;
  onContinue: () => void;
  onEnd: () => void;
}

/** A session left before its end: gone on with, or finished as it is. */
function PausedRow({
  sitting,
  names,
  onContinue,
  onEnd,
}: PausedRowProps): ReactNode {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2 py-4">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium text-ink">
          {sitting.structures.map((key) => names.get(key) ?? key).join(", ")}
        </span>
        <span className="text-sm text-ink-soft">
          {t("structures.paused.progress", {
            done: sitting.done,
            total: sitting.total,
          })}
        </span>
      </span>
      <Button size="sm" variant="primary" onClick={onContinue}>
        {t("structures.paused.continue")}
      </Button>
      <Button size="sm" onClick={onEnd}>
        {t("structures.paused.end")}
      </Button>
    </li>
  );
}

interface StructureRowProps {
  structure: StructureInfo;
  picked: boolean;
  onToggle: () => void;
}

/** One structure of the list: picked or not for the session to come. */
function StructureRow({
  structure,
  picked,
  onToggle,
}: StructureRowProps): ReactNode {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-2 py-3.5 text-left hover:bg-raised"
      >
        <span
          aria-hidden
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-sm border",
            picked
              ? "border-accent-strong bg-accent text-on-accent"
              : "border-line-strong",
          )}
        >
          {picked && <Check className="size-3.5" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium text-ink">{structure.name}</span>
          <span className="text-sm text-ink-soft">
            {formOf(structure.key, t)}
            {" · "}
            <span className="italic">{structure.example}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-sm text-ink-faint">
          {structure.due && (
            <span className="font-medium text-accent-text">
              {t("structures.due")}
            </span>
          )}
          {t(`level.${structure.level}`)}
          <StrengthMark strength={structure.strength} />
        </span>
      </button>
    </li>
  );
}

interface StructureMenuProps {
  navigate: Navigate;
}

/**
 * The menu of the structures, in one screen: the chapter the learner is on,
 * what was left unfinished, and every structure, all levels unless one is
 * chosen. A session takes the structures picked or, with none picked, every
 * one in the list.
 */
export function StructureMenu({ navigate }: StructureMenuProps): ReactNode {
  const { t } = useTranslation();
  const [state, setState] = useState<StructuresState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [size, setSize] = useState<number>(DEFAULT_SIZE);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setState(await structuresState());
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === null) {
    return (
      <main className="grid h-full place-items-center px-10">
        {failure === null ? (
          <Spinner />
        ) : (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </main>
    );
  }

  const names = new Map(state.structures.map((each) => [each.key, each.name]));
  const shown = state.structures.filter(
    (each) => level === null || each.level === level,
  );
  // In the catalogue's order, whatever order they were picked in.
  const chosen = state.structures
    .filter((each) => picked.has(each.key))
    .map((each) => each.key);

  const toggle = (key: string): void => {
    const next = new Set(picked);
    if (!next.delete(key)) {
      next.add(key);
    }
    setPicked(next);
  };

  const start = async (): Promise<void> => {
    setStarting(true);
    setFailure(null);
    try {
      const keys = chosen.length > 0 ? chosen : shown.map((each) => each.key);
      const sitting = await startStructureSitting(keys, size, null);
      navigate({ name: "structures", running: sitting.id });
    } catch (error) {
      setFailure(errorMessage(error));
      setStarting(false);
    }
  };

  const end = async (id: string): Promise<void> => {
    try {
      await closeStructureSitting(id, true);
      await load();
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const { chapter } = state;
  return (
    <main className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-10 px-10 py-16">
          <header className="flex flex-col gap-3">
            <h1 className="text-display font-semibold text-ink">
              {t("structures.title")}
            </h1>
            <p className="text-lead text-ink-soft">{t("structures.intro")}</p>
          </header>
          {failure !== null && (
            <Notice tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}
          {chapter !== null && (
            <ChapterCard
              found={chapter}
              names={names}
              onOpen={() => {
                navigate({ name: "structures", chapterId: chapter.chapter.id });
              }}
            />
          )}
          {state.paused.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-medium text-ink-faint">
                {t("structures.paused.title")}
              </h2>
              <ul className="flex flex-col divide-y divide-line border-y border-line">
                {state.paused.map((sitting) => (
                  <PausedRow
                    key={sitting.id}
                    sitting={sitting}
                    names={names}
                    onContinue={() => {
                      navigate({ name: "structures", running: sitting.id });
                    }}
                    onEnd={() => void end(sitting.id)}
                  />
                ))}
              </ul>
            </section>
          )}
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-ink-faint">
                {t("structures.all")}
              </h2>
              <div
                role="group"
                aria-label={t("structures.filter.label")}
                className="flex flex-wrap gap-2"
              >
                <Chip
                  selected={level === null}
                  onClick={() => {
                    setLevel(null);
                  }}
                >
                  {t("structures.filter.all")}
                </Chip>
                {LEVELS.map((each) => (
                  <Chip
                    key={each}
                    selected={level === each}
                    onClick={() => {
                      setLevel(each);
                    }}
                  >
                    {t(`level.${each}`)}
                  </Chip>
                ))}
              </div>
            </div>
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {shown.map((structure) => (
                <StructureRow
                  key={structure.key}
                  structure={structure}
                  picked={picked.has(structure.key)}
                  onToggle={() => {
                    toggle(structure.key);
                  }}
                />
              ))}
            </ul>
          </section>
        </div>
      </div>
      <StartBar
        size={size}
        onSize={setSize}
        note={
          chosen.length > 0
            ? t("structures.selection", { count: chosen.length })
            : t("structures.selectionNone", { count: shown.length })
        }
        starting={starting}
        onStart={() => void start()}
      />
    </main>
  );
}
