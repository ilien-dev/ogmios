import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StructuresState } from "@shared/structures";
import type { Navigate } from "@/app/routes";
import { HubCard, HubGrid } from "@/components/ui/HubCard";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { chapterName } from "@/features/books/chapterName";
import { errorMessage } from "@/lib/errors";
import { structuresState } from "@/lib/ipc";

interface StructuresHubProps {
  navigate: Navigate;
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

  const { chapter, paused } = state;
  const [only] = paused;
  const firm = state.structures.filter(
    (each) => each.strength === "firm",
  ).length;

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-10 px-10 py-16">
        <header className="flex flex-col gap-3">
          <h1 className="text-display font-semibold text-ink">
            {t("structures.title")}
          </h1>
          <p className="text-lead text-ink-soft">{t("structures.intro")}</p>
        </header>
        <HubGrid>
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
          {chapter !== null && (
            <HubCard
              title={t("structures.hub.chapterTitle")}
              text={t("structures.hub.chapterText")}
              status={`${chapter.bookTitle} · ${chapterName(chapter.chapter, t)}`}
              onClick={() => {
                navigate({ name: "structures", chapterId: chapter.chapter.id });
              }}
            />
          )}
          {only !== undefined && (
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
          )}
        </HubGrid>
      </div>
    </main>
  );
}
