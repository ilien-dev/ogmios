import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { StructureResult, StructureSitting } from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { RunFrame } from "@/features/books/RunFrame";
import { SittingStage } from "@/features/books/SittingParts";
import { errorMessage } from "@/lib/errors";
import {
  answerStructure,
  closeStructureSitting,
  dropStructureWord,
  getStructureSitting,
  startStructureSitting,
  structuresState,
} from "@/lib/ipc";
import { StructureEnd } from "./StructureEnd";
import { StructureForm } from "./StructureForm";
import { StructureWriting } from "./StructureWriting";

interface StructureRunProps {
  sittingId: string;
  /** Back to the menu: the session was paused, or its summary was read. */
  onLeave: () => void;
  /** Another session like this one was started. */
  onAgain: (sittingId: string) => void;
}

/**
 * One session with the whole window: a sentence at a time, written on the
 * left with the form of its structure on the right, and under it, always,
 * the two ways out: pausing, to go on later, and finishing. Once finished it
 * says how each structure went.
 */
export function StructureRun({
  sittingId,
  onLeave,
  onAgain,
}: StructureRunProps): ReactNode {
  const { t } = useTranslation();
  const [sitting, setSitting] = useState<StructureSitting | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [result, setResult] = useState<StructureResult | null>(null);
  const [sent, setSent] = useState("");
  const [peeked, setPeeked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([getStructureSitting(sittingId), structuresState()])
      .then(([opened, state]) => {
        if (live) {
          setSitting(opened);
          setNames(
            new Map(state.structures.map((each) => [each.key, each.name])),
          );
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
  }, [sittingId]);

  /** Runs one step with the backend, showing why it failed if it does. */
  const run = async (step: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await step();
    } catch (error) {
      setFailure(errorMessage(error));
    }
    setBusy(false);
  };

  const view = (): ReactNode => {
    if (sitting === null) {
      return (
        <main className="grid h-full place-items-center px-10">
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

    if (sitting.summary !== null) {
      return (
        <StructureEnd
          summary={sitting.summary}
          names={names}
          starting={busy}
          onAgain={() =>
            void run(async () => {
              const next = await startStructureSitting(
                sitting.structures,
                sitting.size,
                sitting.chapterId,
              );
              onAgain(next.id);
            })
          }
          onDone={onLeave}
        />
      );
    }

    const { item } = sitting;
    const check = (text: string): void => {
      if (item === null || busy) {
        return;
      }
      const written = text.trim();
      void run(async () => {
        const judged = await answerStructure(
          sittingId,
          item.index,
          written,
          peeked,
        );
        setSent(written);
        setResult(judged);
      });
    };
    const dropWord = (): void => {
      if (item === null || busy) {
        return;
      }
      void run(async () => {
        setSitting(await dropStructureWord(sittingId, item.index));
      });
    };
    const next = (): void => {
      // Enter on the way on is one step: a second one finds it running.
      if (busy) {
        return;
      }
      void run(async () => {
        setSitting(await getStructureSitting(sittingId));
        setResult(null);
        setSent("");
        setPeeked(false);
      });
    };
    /** Pauses the session, or finishes it and shows how it went. */
    const leave = (finished: boolean): void => {
      void run(async () => {
        await closeStructureSitting(sittingId, finished);
        // One with nothing written is not kept: there is nothing to show.
        if (finished && sitting.done + (result === null ? 0 : 1) > 0) {
          setSitting(await getStructureSitting(sittingId));
        } else {
          onLeave();
        }
      });
    };

    const answered = sitting.done + (result === null ? 0 : 1);
    return (
      <RunFrame
        barLabel={t("structures.run.progress")}
        value={answered}
        total={sitting.total}
        count={t("structures.run.count", {
          current: Math.min(sitting.done + 1, sitting.total),
          total: sitting.total,
        })}
        failure={failure}
        busy={busy}
        pause={t("structures.run.pause")}
        finish={t("structures.run.finish")}
        onPause={() => {
          leave(false);
        }}
        onFinish={() => {
          leave(true);
        }}
      >
        <SittingStage step={item === null ? "none" : String(item.index)}>
          {item !== null && (
            <div className="mx-auto grid w-full max-w-5xl grid-cols-5 items-start gap-10 p-6 nav:px-10">
              <div className="col-span-3">
                <StructureWriting
                  item={item}
                  result={result}
                  sent={sent}
                  peeked={peeked && !item.warm}
                  checking={busy && result === null}
                  last={
                    answered >= sitting.total && result?.verdict !== "wrong"
                  }
                  onCheck={check}
                  onPeek={() => {
                    setPeeked(true);
                  }}
                  onDropWord={dropWord}
                  onNext={next}
                />
              </div>
              <div className="col-span-2">
                <StructureForm
                  item={item}
                  shown={item.warm || peeked}
                  onShow={
                    result === null
                      ? () => {
                          setPeeked(true);
                        }
                      : null
                  }
                />
              </div>
            </div>
          )}
        </SittingStage>
      </RunFrame>
    );
  };

  return (
    <Swap
      as="div"
      id={
        sitting === null ? "loading" : sitting.summary === null ? "run" : "end"
      }
      className="h-full"
    >
      {view()}
    </Swap>
  );
}
