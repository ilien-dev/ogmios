import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { useScreenLeaving } from "@/lib/motion";
import { X } from "lucide-react";
import type { Report } from "@shared/domain";
import { Stagger } from "@/components/motion/Stagger";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import { getReport } from "@/lib/ipc";
import { AchievementCard } from "./cards/AchievementCard";
import { ChallengeCard } from "./cards/ChallengeCard";
import { ClosingCard } from "./cards/ClosingCard";
import { CorrectionView } from "./cards/CorrectionView";
import { CouldHaveSaidCard } from "./cards/CouldHaveSaidCard";
import { MetricsCard } from "./cards/MetricsCard";
import { NativeRewriteCard } from "./cards/NativeRewriteCard";
import { VocabularyCard } from "./cards/VocabularyCard";
import { ReportBoard } from "./ReportBoard";
import { ReportStage } from "./ReportStage";
import type { Step } from "./steps";
import { toSteps } from "./steps";

interface ReportScreenProps {
  sessionId: string;
  initial: Report | null;
  /** Straight after its conversation, or from the list of past ones. */
  origin: "session" | "past";
  navigate: Navigate;
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * §7: the end-of-session report as a sequence of cards, one at a time, each
 * skippable. The column of glass sums it up and goes to any card; the scene
 * raises the current one. Arrow keys move between cards when no text field
 * has focus.
 */
export function ReportScreen({
  sessionId,
  initial,
  navigate,
}: ReportScreenProps): ReactNode {
  const { t } = useTranslation();
  const [report, setReport] = useState<Report | null>(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const leaving = useScreenLeaving();
  const steps = report === null ? [] : toSteps(report.cards);
  const total = steps.length;

  useEffect(() => {
    if (initial !== null) {
      return;
    }
    let live = true;
    getReport(sessionId)
      .then((found) => {
        if (live) {
          setReport(found ?? { sessionId, cards: [] });
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
  }, [initial, sessionId]);

  useEffect(() => {
    if (leaving) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (
        typing(event.target) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      if (event.key === "ArrowRight") {
        setIndex((held) => Math.min(held + 1, Math.max(total - 1, 0)));
      } else if (event.key === "ArrowLeft") {
        setIndex((held) => Math.max(held - 1, 0));
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [total, leaving]);

  const leave = (): void => {
    navigate({ name: "home" });
  };

  const view = (): ReactNode => {
    if (report === null) {
      return (
        <main className="grid h-full place-items-center">
          <Presence swap>
            {failure === null ? (
              <Reveal
                key="loading"
                as="p"
                kind="fade"
                index={0}
                className="flex items-center gap-3 text-sm text-ink-faint"
              >
                <Spinner />
                {t("report.loading")}
              </Reveal>
            ) : (
              <Notice key="failed" tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            )}
          </Presence>
        </main>
      );
    }

    const step = steps[index] ?? steps[0];
    const where = t("report.step", { current: index + 1, total });

    const render = (current: Step): ReactNode => {
      switch (current.kind) {
        case "achievement":
          return <AchievementCard card={current.card} />;
        case "focus":
          return <CorrectionView card={current.card} />;
        case "minors":
          return (
            <Stagger className="flex flex-col divide-y divide-line">
              {current.cards.map((card) => (
                <Reveal key={card.itemId} className="py-5 first:pt-0 last:pb-0">
                  <CorrectionView card={card} compact />
                </Reveal>
              ))}
            </Stagger>
          );
        case "couldHaveSaid":
          return <CouldHaveSaidCard card={current.card} />;
        case "nativeRewrite":
          return <NativeRewriteCard rewrite={current.rewrite} />;
        case "vocabulary":
          return <VocabularyCard card={current.card} />;
        case "metrics":
          return <MetricsCard card={current.card} />;
        case "challenge":
          return <ChallengeCard card={current.card} />;
        case "closing":
          return (
            <ClosingCard
              focusPatternId={current.focusPatternId}
              empty={report.cards.length === 0}
              navigate={navigate}
              onDone={leave}
            />
          );
        default:
          return null;
      }
    };

    return (
      <main aria-label={t("report.label")} className="h-full overflow-y-auto">
        <p className="sr-only" aria-live="polite">
          {where}
        </p>
        <p className="sr-only">{t("report.keys")}</p>
        <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:flex-row">
          <div className="flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md">
            <Reveal
              as="header"
              kind="fade"
              index={0}
              className="flex items-center gap-2.5"
            >
              <span className="inline-flex h-10 min-w-0 items-center gap-2 rounded-full glass px-4 text-sm text-ink-soft">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 animate-breathe rounded-full bg-mint"
                />
                <span className="truncate">{`${t("report.label")} · ${where}`}</span>
              </span>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={leave}
                className="group ml-auto grid size-10 cursor-pointer place-items-center rounded-full glass text-ink transition-control hover:shadow-lift"
              >
                <X
                  aria-hidden
                  className="size-4.5 transition-transform duration-300 ease-out-expo group-hover:rotate-90"
                />
              </button>
            </Reveal>
            <ReportBoard steps={steps} index={index} onPick={setIndex} />
          </div>
          <ReportStage
            steps={steps}
            index={index}
            where={where}
            body={step === undefined ? null : render(step)}
            onPrevious={() => {
              setIndex((held) => Math.max(held - 1, 0));
            }}
            onNext={() => {
              setIndex((held) => Math.min(held + 1, total - 1));
            }}
            className="min-h-160 min-w-0 flex-1"
          />
        </div>
      </main>
    );
  };

  return (
    <Swap
      as="div"
      id={report === null ? "loading" : "ready"}
      className="h-full"
    >
      {view()}
    </Swap>
  );
}
