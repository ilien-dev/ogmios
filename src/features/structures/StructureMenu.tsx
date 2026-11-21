import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Level } from "@shared/domain";
import type { StructuresState } from "@shared/structures";
import type { Navigate } from "@/app/routes";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { BackLink } from "@/components/ui/BackLink";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { SittingWait } from "@/features/books/SittingParts";
import { errorMessage } from "@/lib/errors";
import {
  closeStructureSitting,
  startStructureSitting,
  structuresState,
} from "@/lib/ipc";
import { StatChip } from "@/components/scene/Stats";
import { HubScreen } from "@/features/drills/ScreenParts";
import { ChapterCard } from "./ChapterCard";
import { LEVELS, LevelScene } from "./LevelScene";
import { StartBar } from "./StartBar";
import { PausedRow, StructureRow } from "./StructureRows";
import { DEFAULT_SIZE } from "./structureText";

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

  const names = new Map(
    state?.structures.map((each) => [each.key, each.name]) ?? [],
  );
  const shown = (state?.structures ?? []).filter(
    (each) => level === null || each.level === level,
  );
  // In the catalogue's order, whatever order they were picked in.
  const chosen = (state?.structures ?? [])
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

  const chapter = state?.chapter ?? null;
  const paused = state?.paused ?? [];
  return (
    <Presence swap>
      {state === null ? (
        <Reveal key="wait" as="main" kind="fade" className="relative h-full">
          <SittingWait failure={failure} />
        </Reveal>
      ) : (
        <Reveal key="menu" kind="fade" className="h-full">
          <HubScreen
            aside={
              <>
                <Reveal className="flex flex-col gap-3">
                  <BackLink
                    label={t("structures.title")}
                    onClick={() => {
                      navigate({ name: "structures" });
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <StatChip value={chosen.length} tone="accent">
                      {t("structures.board.picked", { count: chosen.length })}
                    </StatChip>
                    <StatChip value={shown.length}>
                      {t("structures.board.structures", {
                        count: shown.length,
                      })}
                    </StatChip>
                  </div>
                </Reveal>
                <Presence>
                  {chapter !== null && (
                    <Reveal key="chapter">
                      <ChapterCard
                        found={chapter}
                        names={names}
                        onOpen={() => {
                          navigate({
                            name: "structures",
                            chapterId: chapter.chapter.id,
                          });
                        }}
                      />
                    </Reveal>
                  )}
                </Presence>
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
                                navigate({
                                  name: "structures",
                                  running: sitting.id,
                                });
                              }}
                              onEnd={() => void end(sitting.id)}
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
                            toggle(structure.key);
                          }}
                        />
                      ))}
                    </Presence>
                  </ul>
                </Reveal>
              </>
            }
            scene={
              <LevelScene
                title={t("structures.hub.freeTitle")}
                text={t("structures.hub.freeText")}
                structures={state.structures}
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
                }
              />
            }
          />
        </Reveal>
      )}
    </Presence>
  );
}
