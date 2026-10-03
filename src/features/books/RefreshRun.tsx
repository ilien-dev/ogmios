import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Refresh, RefreshStep } from "@shared/domain";
import { errorMessage } from "@/lib/errors";
import { answerRefresh, startRefresh } from "@/lib/ipc";
import { SittingItem } from "./SittingItem";
import { SittingEnd, SittingFrame, SittingWait } from "./SittingParts";

/** The pass on the screen, and how many words it has shown here. */
interface Pass {
  id: string;
  step: RefreshStep;
  turn: number;
}

function began(refresh: Refresh): Pass {
  return { id: refresh.id, step: refresh.step, turn: 0 };
}

interface AskingProps {
  pass: Pass;
  nativeLang: string;
  onPractise: () => void;
  onDone: () => void;
  /** The pass goes on to this. */
  onNext: (step: RefreshStep) => void;
}

/** What a pass shows under its bar: its word, or its summary. */
function Asking({
  pass,
  nativeLang,
  onPractise,
  onDone,
  onNext,
}: AskingProps): ReactNode {
  const { t } = useTranslation();
  const { id, step } = pass;
  if (step.type === "summary") {
    const { solid, reopened } = step.summary;
    const back = { label: t("books.refresh.back"), onChoose: onDone };
    const slipped = reopened > 0;
    return (
      <SittingEnd
        title={t("books.refresh.summary")}
        lead={t("books.refresh.solid", { count: solid })}
        leadGrade={solid > 0 ? "right" : undefined}
        restGrade={slipped ? "wrong" : undefined}
        rest={
          slipped
            ? t("books.refresh.reopened", { count: reopened })
            : t("books.refresh.allSolid")
        }
        first={
          slipped
            ? {
                label: t("books.refresh.practise", { count: reopened }),
                onChoose: onPractise,
              }
            : back
        }
        other={slipped ? back : null}
      />
    );
  }
  const { wordId } = step.item;
  return (
    <SittingItem
      key={pass.turn}
      nativeLang={nativeLang}
      item={step.item}
      check={(answer: string) => answerRefresh(id, wordId, answer)}
      know={null}
      dispute={null}
      notice={null}
      onDispute={null}
      onNext={onNext}
    />
  );
}

interface RefreshRunProps {
  chapterId: string;
  nativeLang: string;
  /** To practising the words that slipped. */
  onPractise: () => void;
  /** Leaving, at any moment or from the summary. */
  onDone: () => void;
}

/**
 * The quick refresh before reading: the chapter's done words, English →
 * native, each once, with the same form practice asks with. A miss puts the
 * word back in practice, and the summary says how many went back. Leaving
 * keeps every answer: the next refresh goes on with the words not asked yet.
 * The bar at the top is the words asked out of the ones the pass asks: it
 * only goes forward, a word at a time, and is full on the summary.
 */
export function RefreshRun({
  chapterId,
  nativeLang,
  onPractise,
  onDone,
}: RefreshRunProps): ReactNode {
  const { t } = useTranslation();
  const [pass, setPass] = useState<Pass | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    startRefresh(chapterId)
      .then((refresh) => {
        if (live) {
          setPass(began(refresh));
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
  }, [chapterId]);

  return (
    <SittingFrame
      leave={t("books.refresh.leave")}
      progress={pass?.step.progress ?? null}
      onClose={onDone}
    >
      {pass === null ? (
        <SittingWait failure={failure} />
      ) : (
        <Asking
          pass={pass}
          nativeLang={nativeLang}
          onPractise={onPractise}
          onDone={onDone}
          onNext={(next) => {
            setPass((held) =>
              held === null
                ? held
                : { ...held, step: next, turn: held.turn + 1 },
            );
          }}
        />
      )}
    </SittingFrame>
  );
}
