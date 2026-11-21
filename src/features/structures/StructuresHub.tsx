import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StructuresState } from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import type { Navigate } from "@/app/routes";
import { Stagger } from "@/components/motion/Stagger";
import { StatChip, StatTile } from "@/components/scene/Stats";
import { HubCard } from "@/components/ui/HubCard";
import { SittingWait } from "@/features/books/SittingParts";
import { chapterName } from "@/features/books/chapterName";
import { HubScreen } from "@/features/drills/ScreenParts";
import { StrengthMark } from "@/features/recall/StrengthMark";
import { errorMessage } from "@/lib/errors";
import { structuresState } from "@/lib/ipc";
import { LevelScene, LevelTable } from "./LevelScene";

interface StructuresHubProps {
  navigate: Navigate;
}

interface CardsProps {
  state: StructuresState;
  navigate: Navigate;
}

/** The ways in: any structure, the chapter's, and what was left unfinished. */
function Cards({ state, navigate }: CardsProps): ReactNode {
  const { t } = useTranslation();
  const { chapter, paused } = state;
  const [only] = paused;
  const firm = state.structures.filter(
    (each) => each.strength === "firm",
  ).length;
  return (
    <Stagger className="flex flex-col gap-3">
      <Reveal>
        <HubCard
          title={t("structures.hub.freeTitle")}
          text={t("structures.hub.freeText")}
          status={t("structures.hub.freeStatus", {
            count: state.structures.length,
            firm,
          })}
          onClick={() => {
            navigate({ name: "structures", catalog: true });
          }}
        />
      </Reveal>
      <Presence>
        {chapter !== null && (
          <Reveal key="chapter">
            <HubCard
              title={t("structures.hub.chapterTitle")}
              text={t("structures.hub.chapterText")}
              status={`${chapter.bookTitle} · ${chapterName(chapter.chapter, t)}`}
              onClick={() => {
                navigate({ name: "structures", chapterId: chapter.chapter.id });
              }}
            />
          </Reveal>
        )}
      </Presence>
      <Presence>
        {only !== undefined && (
          <Reveal key="only">
            <HubCard
              title={t("structures.hub.pausedTitle")}
              text={t("structures.hub.pausedText")}
              status={
                paused.length === 1
                  ? t("structures.hub.pausedOne", {
                      done: only.done,
                      total: only.total,
                    })
                  : t("structures.hub.pausedMany", { count: paused.length })
              }
              due
              onClick={() => {
                navigate(
                  paused.length === 1
                    ? { name: "structures", running: only.id }
                    : { name: "structures", catalog: true },
                );
              }}
            />
          </Reveal>
        )}
      </Presence>
    </Stagger>
  );
}

/**
 * The structures section: how the structures stand and the ways in on the
 * left (any structure, the chapter the learner is on, what was left
 * unfinished, the last two only when there is something behind them), and
 * the levels raised in the scene with a table of them along its bottom.
 */
export function StructuresHub({ navigate }: StructuresHubProps): ReactNode {
  const [state, setState] = useState<StructuresState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    structuresState()
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

  return (
    <Presence swap>
      {state === null ? (
        <Reveal key="wait" as="main" kind="fade" className="relative h-full">
          <SittingWait failure={failure} />
        </Reveal>
      ) : (
        <Reveal key="hub" kind="fade" className="h-full">
          <Loaded state={state} navigate={navigate} />
        </Reveal>
      )}
    </Presence>
  );
}

/** The screen once the structures are read. */
function Loaded({ state, navigate }: CardsProps): ReactNode {
  const { t } = useTranslation();
  const structures = state.structures;
  const count = (strength: "settling" | "firm"): number =>
    structures.filter((each) => each.strength === strength).length;
  const due = structures.filter((each) => each.due).length;
  return (
    <HubScreen
      aside={
        <>
          <Reveal className="flex flex-wrap gap-2">
            <StatChip value={due} tone="accent">
              {t("structures.board.due")}
            </StatChip>
            <StatChip value={state.paused.length}>
              {t("structures.board.paused", { count: state.paused.length })}
            </StatChip>
          </Reveal>
          <Reveal className="grid grid-cols-2 gap-3">
            <StatTile
              icon={<StrengthMark strength="settling" />}
              label={t("recall.strength.settling")}
              value={count("settling")}
            />
            <StatTile
              icon={<StrengthMark strength="firm" />}
              label={t("recall.strength.firm")}
              value={count("firm")}
            />
          </Reveal>
          <Reveal>
            <Cards state={state} navigate={navigate} />
          </Reveal>
        </>
      }
      scene={
        <LevelScene
          title={t("structures.title")}
          text={t("structures.intro")}
          structures={structures}
          footer={<LevelTable structures={structures} />}
        />
      }
    />
  );
}
