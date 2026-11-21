import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Level } from "@shared/domain";
import type { StructureInfo, StructuresState } from "@shared/structures";
import type { Navigate } from "@/app/routes";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { StatChip } from "@/components/scene/Stats";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/errors";
import {
  closeStructureSitting,
  startStructureSitting,
  structuresState,
} from "@/lib/ipc";
import { LEVELS, LevelScene, LevelTable } from "./LevelScene";
import { StartBar } from "./StartBar";
import { PausedRow, StructureRow } from "./StructureRows";
import { DEFAULT_SIZE } from "./structureText";

/** The catalogue of structures, and the free session being put together. */
export interface Catalogue {
  /** Null until read. */
  state: StructuresState | null;
  failure: string | null;
  /** The level the list is narrowed to; null for every level. */
  level: Level | null;
  setLevel: (level: Level | null) => void;
  /** The structures of the list as it is narrowed. */
  shown: readonly StructureInfo[];
  picked: ReadonlySet<string>;
  toggle: (key: string) => void;
  /** The keys picked, in the catalogue's order. */
  chosen: readonly string[];
  size: number;
  setSize: (size: number) => void;
  /** A session is being started. */
  starting: boolean;
  /** Starts a free session on the ones picked, or on the whole list. */
  start: () => void;
  /** Goes on with a session left before its end. */
  resume: (sittingId: string) => void;
  /** Finishes such a session as it is. */
  end: (sittingId: string) => void;
}

/**
 * Reads the catalogue as its screen opens and holds what the learner picks
 * from it. A session takes the structures picked or, with none picked, every
 * one in the list; it is not tied to a chapter.
 */
export function useCatalogue(navigate: Navigate): Catalogue {
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

  const all = state?.structures ?? [];
  const shown = all.filter((each) => level === null || each.level === level);
  // In the catalogue's order, whatever order they were picked in.
  const chosen = all
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

  return {
    state,
    failure,
    level,
    setLevel,
    shown,
    picked,
    toggle,
    chosen,
    size,
    setSize,
    starting,
    start: () => void start(),
    resume: (sittingId) => {
      navigate({ name: "structures", running: sittingId });
    },
    end: (sittingId) => void end(sittingId),
  };
}

/**
 * The catalogue on the column of glass: how the levels stand, what was left
 * unfinished, and every structure, all levels unless one is chosen.
 */
export function CatalogueBoard({
  catalogue,
}: {
  catalogue: Catalogue;
}): ReactNode {
  const { t } = useTranslation();
  const { state, level, setLevel, shown, picked, chosen } = catalogue;
  const names = new Map(
    state?.structures.map((each) => [each.key, each.name]) ?? [],
  );
  const paused = state?.paused ?? [];
  const due = (state?.structures ?? []).filter((each) => each.due).length;
  return (
    <Presence swap>
      {state === null ? (
        <Reveal
          key="wait"
          kind="fade"
          className="grid place-items-center rounded-xl glass p-6"
        >
          <Spinner />
        </Reveal>
      ) : (
        <Reveal key="catalogue" kind="fade">
          <Stagger className="flex flex-col gap-3.5">
            <Reveal className="flex flex-wrap gap-2">
              <StatChip value={due} tone="accent">
                {t("structures.board.due")}
              </StatChip>
              <StatChip value={chosen.length}>
                {t("structures.board.picked", { count: chosen.length })}
              </StatChip>
              <StatChip value={shown.length}>
                {t("structures.board.structures", { count: shown.length })}
              </StatChip>
            </Reveal>
            <LevelTable structures={state.structures} />
            <Presence>
              {paused.length > 0 && (
                <Reveal
                  as="section"
                  key="paused"
                  className="flex flex-col gap-2.5"
                >
                  <h2 className="px-1 font-display text-base tracking-tight text-ink">
                    {t("structures.paused.title")}
                  </h2>
                  <ul className="flex flex-col divide-y divide-line rounded-xl glass py-1">
                    <Presence>
                      {paused.map((sitting, index) => (
                        <PausedRow
                          key={sitting.id}
                          sitting={sitting}
                          names={names}
                          index={index}
                          onContinue={() => {
                            catalogue.resume(sitting.id);
                          }}
                          onEnd={() => {
                            catalogue.end(sitting.id);
                          }}
                        />
                      ))}
                    </Presence>
                  </ul>
                </Reveal>
              )}
            </Presence>
            <Reveal as="section" className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                <h2 className="font-display text-base tracking-tight text-ink">
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
              <ul className="flex flex-col divide-y divide-line rounded-xl glass py-1">
                <Presence>
                  {shown.map((structure, index) => (
                    <StructureRow
                      key={structure.key}
                      structure={structure}
                      picked={picked.has(structure.key)}
                      index={index}
                      onToggle={() => {
                        catalogue.toggle(structure.key);
                      }}
                    />
                  ))}
                </Presence>
              </ul>
            </Reveal>
          </Stagger>
        </Reveal>
      )}
    </Presence>
  );
}

/**
 * The scene of the catalogue: the three levels raised as columns, the ones
 * picked from in teal, and along the bottom the way into a free session.
 */
export function CatalogueScene({
  catalogue,
}: {
  catalogue: Catalogue;
}): ReactNode {
  const { t } = useTranslation();
  const { state, failure, shown, picked, chosen } = catalogue;
  return (
    <LevelScene
      title={t("structures.title")}
      text={t("structures.free")}
      structures={state?.structures ?? []}
      picked={picked}
      extra={
        <Presence>
          {failure !== null && (
            <Notice key="failure" tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}
        </Presence>
      }
      footer={
        <Presence>
          {state !== null && (
            <Reveal key="start" kind="fade">
              <StartBar
                size={catalogue.size}
                onSize={catalogue.setSize}
                note={
                  chosen.length > 0
                    ? t("structures.selection", { count: chosen.length })
                    : t("structures.selectionNone", { count: shown.length })
                }
                starting={catalogue.starting}
                onStart={catalogue.start}
              />
            </Reveal>
          )}
        </Presence>
      }
    />
  );
}
