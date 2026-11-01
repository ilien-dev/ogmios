import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Level } from "@shared/domain";
import type { StructuresState } from "@shared/structures";
import type { Navigate } from "@/app/routes";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
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
import { ChapterCard } from "./ChapterCard";
import { StartBar } from "./StartBar";
import { PausedRow, StructureRow } from "./StructureRows";
import { DEFAULT_SIZE } from "./structureText";

const LEVELS: readonly Level[] = ["basic", "intermediate", "advanced"];

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
    <main className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <Presence swap>
          {state === null ? (
            <Reveal key="wait" kind="fade" className="h-full">
              <SittingWait failure={failure} />
            </Reveal>
          ) : (
            <Reveal key="menu" kind="fade">
              <Stagger className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12 nav:py-16">
                <Reveal as="header" className="flex flex-col gap-3">
                  <BackLink
                    label={t("structures.title")}
                    onClick={() => {
                      navigate({ name: "structures" });
                    }}
                  />
                  <h1 className="font-display text-display font-light text-ink">
                    {t("structures.hub.freeTitle")}
                  </h1>
                  <p className="text-lead text-ink-soft">
                    {t("structures.hub.freeText")}
                  </p>
                </Reveal>
                <Presence>
                  {failure !== null && (
                    <Notice key="failure" tone="danger">
                      {t("common.error", { message: failure })}
                    </Notice>
                  )}
                </Presence>
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
                      className="flex flex-col gap-4"
                    >
                      <h2 className="text-sm font-medium text-ink-faint">
                        {t("structures.paused.title")}
                      </h2>
                      <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface py-1 shadow-card">
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
                <Reveal as="section" className="flex flex-col gap-4">
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
                  <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface py-1 shadow-card">
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
              </Stagger>
            </Reveal>
          )}
        </Presence>
      </div>
      <Presence>
        {state !== null && (
          <Reveal key="start" kind="fade" className="shrink-0">
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
          </Reveal>
        )}
      </Presence>
    </main>
  );
}
