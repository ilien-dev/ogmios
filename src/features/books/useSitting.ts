import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type {
  AnswerResult,
  DisputeResult,
  PracticeOptions,
  PracticeStep,
  Ways,
} from "@shared/domain";
import { errorMessage } from "@/lib/errors";
import {
  disputeAnswer,
  practiceOptions,
  sittingStep,
  startSitting,
} from "@/lib/ipc";
import { hasChoice } from "./SittingParts";
import { began, disputed, settled } from "./sittingRun";
import type { Disputed, Running } from "./sittingRun";

/** What came of "I was right", and the sitting its answer was given in. */
interface Verdict {
  about: Disputed;
  from: string;
  /** Null when Claude could not be asked: the miss stands. */
  outcome: DisputeResult | null;
}

/** Where verdicts go: the sitting on the screen, or the wait for the next. */
interface Desk {
  /** The sitting on the screen; null between two sittings. */
  current: RefObject<string | null>;
  /** Verdicts that arrived between two sittings. */
  waiting: RefObject<Verdict[]>;
  setRunning: Dispatch<SetStateAction<Running | null>>;
}

/**
 * Shows a verdict wherever the learner is by now. Claude takes seconds, and
 * "Continue" may have started another sitting meanwhile: the verdict then
 * carries the step of the sitting its answer was given in, which is over, so
 * what this sitting shows next is read again. Between two sittings the
 * verdict waits for the next one to begin.
 */
async function deliver(desk: Desk, verdict: Verdict): Promise<void> {
  const { about, from, outcome } = verdict;
  const sittingId = desk.current.current;
  if (sittingId === null) {
    desk.waiting.current.push(verdict);
    return;
  }
  if (outcome?.upheld !== true || from === sittingId) {
    desk.setRunning((held) =>
      held === null ? held : settled(held, about, outcome),
    );
    return;
  }
  // Read after the verdict was kept, so it is what the word now allows. If
  // it cannot be read the verdict is told and nothing on the screen moves.
  let now: PracticeStep | null = null;
  try {
    now = await sittingStep(sittingId);
  } catch {
    now = null;
  }
  if (desk.current.current !== sittingId) {
    await deliver(desk, verdict);
    return;
  }
  desk.setRunning((held) =>
    held === null ? held : settled(held, about, outcome, now),
  );
}

/** The session to start: which round of the screen it is, and how. */
interface Plan {
  round: number;
  /** Null for every open word, and for a session that is gone on with. */
  size: number | null;
  /** Both for a session that is gone on with: it keeps the ways it had. */
  ways: Ways;
}

export interface SittingRun {
  /** Null until the sitting has its first word. */
  running: Running | null;
  /** Why the sitting could not start. */
  failure: string | null;
  /**
   * What to choose from before the session starts, its ways and its size;
   * null when there is nothing to choose: a session was left unfinished and
   * is gone on with, or the chapter has one size and one way to ask.
   */
  options: PracticeOptions | null;
  /** Starts the session as chosen; a size of null is every open word. */
  choose: (size: number | null, ways: Ways) => void;
  /** What happened to the sitting, applied to wherever it is by then. */
  move: (change: (held: Running) => Running) => void;
  /** Asks Claude about a miss. A failure is kept quiet: the miss stands. */
  dispute: (result: AnswerResult, wordId: string) => void;
  /** "Continue": the next sitting on the chapter, in place. */
  again: () => void;
}

/**
 * The sittings on a chapter, one after another, for as long as the screen is
 * open. Each begins by asking what "Practice" can do: a session left
 * unfinished is gone on with at once, and otherwise the learner chooses its
 * ways and its size, unless there is nothing to choose. "I was right" is asked from here and not
 * from a word or from one sitting: the learner goes on while Claude answers,
 * into the next sitting if they like, and the verdict is shown wherever they
 * are when it arrives.
 */
export function useSitting(chapterId: string): SittingRun {
  const [running, setRunning] = useState<Running | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [options, setOptions] = useState<PracticeOptions | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const current = useRef<string | null>(null);
  const waiting = useRef<Verdict[]>([]);

  useEffect(() => {
    let live = true;
    practiceOptions(chapterId)
      .then((offered) => {
        if (!live) {
          return;
        }
        if (offered.resume || !hasChoice(offered)) {
          setPlan({ round, size: null, ways: "both" });
        } else {
          setOptions(offered);
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
  }, [chapterId, round]);

  const planned = plan?.round === round ? plan : null;
  const size = planned === null ? undefined : planned.size;
  const ways = planned?.ways ?? "both";
  useEffect(() => {
    if (size === undefined) {
      return;
    }
    let live = true;
    startSitting(chapterId, size, ways)
      .then((sitting) => {
        if (live) {
          current.current = sitting.id;
          setRunning(began(sitting));
          for (const verdict of waiting.current.splice(0)) {
            void deliver({ current, waiting, setRunning }, verdict);
          }
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    return () => {
      live = false;
      current.current = null;
    };
  }, [chapterId, size, ways]);

  const choose = useCallback(
    (chosen: number | null, asked: Ways): void => {
      setOptions(null);
      setPlan({ round, size: chosen, ways: asked });
    },
    [round],
  );

  const move = useCallback((change: (held: Running) => Running): void => {
    setRunning((held) => (held === null ? held : change(held)));
  }, []);

  const dispute = useCallback(
    (result: AnswerResult, wordId: string): void => {
      const from = current.current;
      if (from === null) {
        return;
      }
      const desk = { current, waiting, setRunning };
      const about = { answerId: result.answerId, wordId };
      move((held) => disputed(held, about.answerId));
      disputeAnswer(about.answerId)
        .then((outcome) => deliver(desk, { about, from, outcome }))
        .catch(() => deliver(desk, { about, from, outcome: null }));
    },
    [move],
  );

  const again = useCallback((): void => {
    current.current = null;
    setRunning(null);
    setOptions(null);
    setRound((held) => held + 1);
  }, []);

  return { running, failure, options, choose, move, dispute, again };
}
