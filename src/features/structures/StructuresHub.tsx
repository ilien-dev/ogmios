import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StructuresState } from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import type { Navigate } from "@/app/routes";
import { Stagger } from "@/components/motion/Stagger";
import { HubCard, HubGrid } from "@/components/ui/HubCard";
import { Orb } from "@/components/ui/Orb";
import { SittingWait } from "@/features/books/SittingParts";
import { chapterName } from "@/features/books/chapterName";
import { errorMessage } from "@/lib/errors";
import { structuresState } from "@/lib/ipc";

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
    <HubGrid>
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
    </HubGrid>
  );
}

/**
 * The structures section: a card for a session on any structure, one for
 * those of the chapter the learner is on, and one for what was left
 * unfinished. The last two are there only when there is something behind
 * them.
 */
export function StructuresHub({ navigate }: StructuresHubProps): ReactNode {
  const { t } = useTranslation();
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
    <main className="relative h-full overflow-y-auto">
      <Presence swap>
        {state === null ? (
          <Reveal key="wait" kind="fade" className="h-full">
            <SittingWait failure={failure} />
          </Reveal>
        ) : (
          <Reveal key="hub" kind="fade">
            <Stagger className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-12 nav:py-16">
              <Reveal as="header" className="flex flex-col gap-4">
                <Orb size="sm" section="book" />
                <h1 className="font-display text-display font-light text-ink">
                  {t("structures.title")}
                </h1>
                <p className="text-lead text-ink-soft">
                  {t("structures.intro")}
                </p>
              </Reveal>
              <Cards state={state} navigate={navigate} />
            </Stagger>
          </Reveal>
        )}
      </Presence>
    </main>
  );
}
