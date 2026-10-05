import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RecallAnswer, RecallStep, Ways } from "@shared/domain";
import { SittingItem } from "@/features/books/SittingItem";
import {
  SittingEnd,
  SittingFrame,
  SittingWait,
} from "@/features/books/SittingParts";
import { errorMessage } from "@/lib/errors";
import {
  answerRecall,
  discardRecallSentence,
  hintRecall,
  startRecall,
} from "@/lib/ipc";
import { WordNote } from "./WordNote";

/** The run on the screen, and how many words it has shown here. */
interface Run {
  id: string;
  step: RecallStep;
  turn: number;
}

interface RoundProps {
  ways: Ways;
  nativeLang: string;
  /** Another run, for the words still due. */
  onMore: () => void;
  onDone: () => void;
}

/** One run, from its first word to its summary. */
function Round({ ways, nativeLang, onMore, onDone }: RoundProps): ReactNode {
  const { t } = useTranslation();
  const [run, setRun] = useState<Run | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** The verdict on the word shown, once it is answered. */
  const [last, setLast] = useState<RecallAnswer | null>(null);

  useEffect(() => {
    let live = true;
    startRecall(ways)
      .then((recall) => {
        if (live) {
          setRun({ id: recall.id, step: recall.step, turn: 0 });
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
  }, [ways]);

  const asking = (): ReactNode => {
    if (run === null) {
      return <SittingWait failure={failure} />;
    }
    const { id, step } = run;
    if (step.type === "summary") {
      const { right, missed, left } = step.summary;
      const back = { label: t("recall.back"), onChoose: onDone };
      const more = left > 0;
      return (
        <SittingEnd
          title={t("recall.summary")}
          lead={t("recall.right", { count: right })}
          leadGrade={right > 0 ? "right" : undefined}
          rest={
            missed > 0
              ? t("recall.missed", { count: missed })
              : t("recall.allRight")
          }
          restGrade={missed > 0 ? "wrong" : undefined}
          first={more ? { label: t("recall.more"), onChoose: onMore } : back}
          other={more ? back : null}
        />
      );
    }
    const { wordId } = step.item;
    // A word that keeps slipping, just missed: the learner's note on it.
    const slipped = last !== null && !last.correct && last.stubborn;
    return (
      <SittingItem
        key={run.turn}
        nativeLang={nativeLang}
        item={step.item}
        check={(answer: string, second: boolean, hinted: boolean) =>
          answerRecall(id, step.item, answer, second, hinted)
        }
        hint={(asked) => hintRecall(id, step.item, asked)}
        bad={(result) => discardRecallSentence(id, result.answerId)}
        know={null}
        dispute={null}
        notice={slipped ? <WordNote wordId={wordId} note={last.note} /> : null}
        onAnswered={setLast}
        onDispute={null}
        onNext={(next) => {
          setLast(null);
          setRun({ id, step: next, turn: run.turn + 1 });
        }}
      />
    );
  };

  return (
    <SittingFrame
      leave={t("recall.leave")}
      progress={run?.step.progress ?? null}
      onClose={onDone}
    >
      {asking()}
    </SittingFrame>
  );
}

interface RecallRunProps {
  ways: Ways;
  nativeLang: string;
  /** Leaving, at any moment or from the summary. */
  onDone: () => void;
}

/**
 * A run of the daily recall: up to ten learned words that are due, of any
 * book or conversation, each asked once with the form practice asks with. A
 * right answer sends the word further away, a miss brings it back tomorrow,
 * and neither touches the chapter it came from. Leaving keeps every answer:
 * the words not asked are still due. A word that keeps slipping shows the
 * learner's own note under its miss.
 */
export function RecallRun({
  ways,
  nativeLang,
  onDone,
}: RecallRunProps): ReactNode {
  const [round, setRound] = useState(0);
  return (
    <Round
      key={round}
      ways={ways}
      nativeLang={nativeLang}
      onMore={() => {
        setRound((held) => held + 1);
      }}
      onDone={onDone}
    />
  );
}
