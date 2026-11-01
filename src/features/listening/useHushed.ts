import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ttsStop } from "@/lib/ipc";
import { useScreenLeaving } from "@/lib/motion";

export interface Turns {
  /** Which sentence is the latest: a listen keeps this to know it still is. */
  now: () => number;
  /** Leaves the latest sentence behind. */
  next: () => void;
}

/**
 * Silences what a listening screen is playing the moment the screen starts to
 * leave. Returns a counter of the sentences left behind, so that a listen
 * still on its way no longer counts. Waiting for the exit to end would let it
 * play over the next screen, and stopping again then would cut off whatever
 * that one has begun.
 */
export function useHushed(): Turns {
  const turn = useRef(0);
  const turns = useMemo(
    () => ({
      now: () => turn.current,
      next: () => {
        turn.current += 1;
      },
    }),
    [],
  );
  const leaving = useScreenLeaving();
  const hushed = useRef(false);

  useLayoutEffect(() => {
    if (leaving) {
      hushed.current = true;
      turns.next();
      void ttsStop().catch(() => null);
    }
  }, [leaving, turns]);

  useEffect(
    () => () => {
      turns.next();
      if (!hushed.current) {
        void ttsStop().catch(() => null);
      }
    },
    [turns],
  );
  return turns;
}
