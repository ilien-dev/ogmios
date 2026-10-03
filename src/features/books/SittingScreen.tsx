import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { answerWord, knowWord } from "@/lib/ipc";
import { DisputeNote } from "./DisputeNote";
import { RefreshRun } from "./RefreshRun";
import { SittingItem } from "./SittingItem";
import {
  SittingEnd,
  SittingFrame,
  SittingSizes,
  SittingWait,
} from "./SittingParts";
import { advanced, answered, showsReason } from "./sittingRun";
import { useSitting } from "./useSitting";
import type { SittingRun } from "./useSitting";

interface WordsProps {
  sittings: SittingRun;
  nativeLang: string;
  onDone: () => void;
}

/** What a sitting shows under its bar: its sizes, its word, its summary. */
function Words({ sittings, nativeLang, onDone }: WordsProps): ReactNode {
  const { t } = useTranslation();
  const { running, failure, sizes, choose, move, dispute, again } = sittings;

  if (running === null) {
    return sizes === null || failure !== null ? (
      <SittingWait failure={failure} />
    ) : (
      <SittingSizes sizes={sizes} onStart={choose} />
    );
  }

  const { earlier, step, sittingId } = running;
  const notice =
    earlier === null ? null : (
      <DisputeNote
        state={earlier.state}
        earlier
        withReason={showsReason(earlier, step)}
      />
    );
  if (step.type === "summary") {
    const { done, open } = step.summary;
    const stop = { label: t("common.done"), onChoose: onDone };
    const more = open > 0;
    return (
      <SittingEnd
        title={t("books.sitting.summary")}
        lead={t("books.sitting.done", { count: done })}
        leadGrade={done > 0 ? "right" : undefined}
        rest={
          more
            ? t("books.sitting.open", { count: open })
            : t("books.sitting.allDone")
        }
        first={
          more ? { label: t("books.sitting.continue"), onChoose: again } : stop
        }
        other={more ? stop : null}
        notice={notice}
      />
    );
  }
  const { item } = step;
  const mine = running.answered?.answerId;
  return (
    <SittingItem
      key={`${sittingId}-${String(running.turn)}`}
      nativeLang={nativeLang}
      item={item}
      check={(answer) => answerWord(sittingId, item, answer)}
      know={() => knowWord(sittingId, item.wordId)}
      dispute={mine === undefined ? null : (running.disputes[mine] ?? null)}
      notice={notice}
      onAnswered={(result) => {
        move((held) => answered(held, result));
      }}
      onDispute={(result) => {
        dispute(result, item.wordId);
      }}
      onNext={(next) => {
        move((held) => advanced(held, next));
      }}
    />
  );
}

interface RunProps {
  chapterId: string;
  nativeLang: string;
  onDone: () => void;
}

/**
 * The sittings on a chapter, each from the choice of its size, when there is
 * one to make, to its summary; "Continue" on the summary starts the next one
 * in place. What "I was right" is doing is held above any one sitting
 * (`useSitting`), so a verdict that arrives after "Continue" is still shown,
 * and still moves a word it settled.
 *
 * The bar is as far as the step on the screen says: a verdict does not move
 * it, going on to the next word does, so it is full when the summary shows
 * and not on the answer before it.
 */
function Run({ chapterId, nativeLang, onDone }: RunProps): ReactNode {
  const { t } = useTranslation();
  const sittings = useSitting(chapterId);
  return (
    <SittingFrame
      leave={t("books.sitting.leave")}
      progress={sittings.running?.step.progress ?? null}
      onClose={onDone}
    >
      <Words sittings={sittings} nativeLang={nativeLang} onDone={onDone} />
    </SittingFrame>
  );
}

interface SittingScreenProps {
  chapterId: string;
  /** The learner's first language, named beside English on each word. */
  nativeLang: string;
  /** The quick refresh before reading, not a sitting of practice. */
  refresh?: boolean;
  /** Leaving, at any moment: every answer given is already kept. */
  onClose: () => void;
  /** From the refresh to practising the words it sent back. */
  onPractise?: () => void;
}

/**
 * A chapter's words, one at a time, with the whole window: practising them,
 * or refreshing the done ones before reading. The chapter is not named while
 * it runs: its name can hold the word being asked.
 */
export function SittingScreen({
  chapterId,
  nativeLang,
  refresh = false,
  onClose,
  onPractise = onClose,
}: SittingScreenProps): ReactNode {
  return refresh ? (
    <RefreshRun
      chapterId={chapterId}
      nativeLang={nativeLang}
      onPractise={onPractise}
      onDone={onClose}
    />
  ) : (
    <Run chapterId={chapterId} nativeLang={nativeLang} onDone={onClose} />
  );
}
