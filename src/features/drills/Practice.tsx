import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Drill, DrillFormat } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import { startDrill } from "@/lib/ipc";
import { DrillRunner } from "./DrillRunner";
import { RunBackdrop, RunCard } from "./ScreenParts";

/** The formats a round can be asked in, as Chat offers them. */
export const DRILL_FORMATS: readonly DrillFormat[] = [
  "sameStructure",
  "transformation",
  "guidedChat",
  "spotError",
];

interface PracticeProps {
  /** The pattern the round is on; null takes what is due. */
  patternId: string | null;
  /** The format it is asked in; null lets the round pick. */
  format: DrillFormat | null;
  navigate: Navigate;
  /** Out of the round, back to wherever it was started from. */
  onLeave: () => void;
}

type Phase =
  | { name: "loading" }
  | { name: "running"; drill: Drill }
  | { name: "failed"; message: string };

/**
 * Names what is on the screen. Each round is its own step: one that came back
 * while the last was still leaving would keep that one's place in the drill.
 */
function stepOf(phase: Phase): string {
  return phase.name === "running" ? phase.drill.id : phase.name;
}

/**
 * §9: a short practice round on the patterns in memory. It takes the whole
 * window from its first frame and has no screen of its own to go back to:
 * every way out leads to where it was started.
 */
export function Practice({
  patternId,
  format,
  navigate,
  onLeave,
}: PracticeProps): ReactNode {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const started = useRef(false);

  const begin = async (): Promise<void> => {
    setPhase({ name: "loading" });
    try {
      const drill = await startDrill(patternId, format);
      setPhase({ name: "running", drill });
    } catch (error) {
      setPhase({ name: "failed", message: errorMessage(error) });
    }
  };

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void begin();
    }
  }, []);

  const body = (): ReactNode => {
    if (phase.name === "running") {
      return (
        <DrillRunner
          drill={phase.drill}
          onAgain={() => {
            // The same round again: the route stays, a new drill is drawn.
            navigate({ name: "practice", patternId, format });
            void begin();
          }}
          onClose={onLeave}
        />
      );
    }

    if (phase.name === "loading") {
      return (
        <RunBackdrop>
          <main className="grid h-full place-items-center">
            <p className="flex items-center gap-3 rounded-full glass px-5 py-3 text-sm text-ink-soft">
              <Spinner />
              {t("drills.loading")}
            </p>
          </main>
        </RunBackdrop>
      );
    }

    return (
      <RunBackdrop>
        <main className="grid h-full place-items-center px-4">
          <RunCard className="flex max-w-lg flex-col gap-6">
            <Notice tone="danger">
              {t("common.error", { message: phase.message })}
            </Notice>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void begin()}>
                {t("common.retry")}
              </Button>
              <Button variant="ghost" onClick={onLeave}>
                {t("drills.back")}
              </Button>
            </div>
          </RunCard>
        </main>
      </RunBackdrop>
    );
  };

  return (
    <div className="relative h-full">
      <Presence swap>
        <Reveal key={stepOf(phase)} kind="fade" className="h-full">
          {body()}
        </Reveal>
      </Presence>
    </div>
  );
}
