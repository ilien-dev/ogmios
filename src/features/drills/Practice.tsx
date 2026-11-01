import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Dumbbell } from "lucide-react";
import type { Drill, DrillFormat } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import { homeState, startDrill } from "@/lib/ipc";
import { DrillRunner } from "./DrillRunner";

const FORMATS = [
  "sameStructure",
  "transformation",
  "guidedChat",
  "spotError",
] as const;

interface PracticeProps {
  patternId: string | null;
  format: DrillFormat | null;
  autostart: boolean;
  navigate: Navigate;
}

type Phase =
  | { name: "landing" }
  | { name: "loading" }
  | { name: "running"; drill: Drill }
  | { name: "failed"; message: string };

/** §9: short practice rounds on the patterns in memory. */
export function Practice({
  patternId,
  format,
  autostart,
  navigate,
}: PracticeProps): ReactNode {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>(
    autostart ? { name: "loading" } : { name: "landing" },
  );
  const [due, setDue] = useState<number | null>(null);
  const autostarted = useRef(false);

  const begin = async (chosen: DrillFormat | null): Promise<void> => {
    setPhase({ name: "loading" });
    try {
      const drill = await startDrill(patternId, chosen);
      setPhase({ name: "running", drill });
    } catch (error) {
      setPhase({ name: "failed", message: errorMessage(error) });
    }
  };

  useEffect(() => {
    if (autostart && !autostarted.current) {
      autostarted.current = true;
      void begin(format);
      return;
    }
    let live = true;
    void homeState().then((home) => {
      if (live) {
        setDue(home.dueReviews);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const body = (): ReactNode => {
    if (phase.name === "running") {
      return (
        <DrillRunner
          drill={phase.drill}
          onAgain={() => void begin(format)}
          onClose={() => {
            navigate({
              name: "practice",
              patternId: null,
              format: null,
              autostart: false,
            });
          }}
        />
      );
    }

    if (phase.name === "loading") {
      return (
        <main className="grid h-full place-items-center">
          <p className="flex items-center gap-3 text-sm text-ink-faint">
            <Spinner />
            {t("drills.loading")}
          </p>
        </main>
      );
    }

    return (
      <main className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-12 px-10 py-16">
          <header className="flex flex-col gap-3">
            <h1 className="font-display text-display font-light text-ink">
              {t("drills.title")}
            </h1>
            <p className="text-lead text-ink-soft">{t("drills.intro")}</p>
          </header>

          <section className="flex flex-col items-start gap-4">
            <p className="text-ink-soft">
              {due === null
                ? " "
                : due > 0
                  ? t("drills.dueCount", { count: due })
                  : t("drills.nothingDue")}
            </p>
            <Button
              variant="primary"
              size="lg"
              icon={<Dumbbell aria-hidden className="size-5" />}
              onClick={() => {
                navigate({
                  name: "practice",
                  patternId,
                  format: null,
                  autostart: true,
                });
              }}
            >
              {due !== null && due > 0
                ? t("drills.startDue")
                : t("drills.startAny")}
            </Button>
            <Presence>
              {phase.name === "failed" && (
                <Notice key="failure" tone="danger">
                  {t("common.error", { message: phase.message })}
                </Notice>
              )}
            </Presence>
          </section>

          <section aria-labelledby="formats" className="flex flex-col gap-4">
            <h2 id="formats" className="text-sm font-medium text-ink-faint">
              {t("drills.formats")}
            </h2>
            <ul className="grid grid-cols-2 gap-2">
              {FORMATS.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => {
                      navigate({
                        name: "practice",
                        patternId,
                        format: item,
                        autostart: true,
                      });
                    }}
                    className="group flex size-full items-start justify-between gap-3 rounded-lg border border-line-strong px-5 py-4 text-left transition-control hover:border-ink-faint hover:bg-raised"
                  >
                    <span className="flex flex-col gap-1">
                      <span className="font-medium text-ink">
                        {t(`drillFormat.${item}`)}
                      </span>
                      <span className="text-sm text-ink-soft">
                        {t(`drillFormat.${item}Hint`)}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    );
  };

  return (
    <div className="relative h-full">
      <Presence swap>
        <Reveal
          key={phase.name === "failed" ? "landing" : phase.name}
          kind="fade"
          className="h-full"
        >
          {body()}
        </Reveal>
      </Presence>
    </div>
  );
}
