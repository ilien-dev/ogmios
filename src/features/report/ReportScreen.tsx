import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Dumbbell,
  MessageCircle,
  X,
} from "lucide-react";
import type { Report } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { getReport } from "@/lib/ipc";
import { AchievementCard } from "./cards/AchievementCard";
import { CardTitle } from "./cards/CardTitle";
import { ChallengeCard } from "./cards/ChallengeCard";
import { CorrectionView } from "./cards/CorrectionView";
import { CouldHaveSaidCard } from "./cards/CouldHaveSaidCard";
import { MetricsCard } from "./cards/MetricsCard";
import { VocabularyCard } from "./cards/VocabularyCard";
import type { Step } from "./steps";
import { toSteps } from "./steps";

interface ReportScreenProps {
  sessionId: string;
  initial: Report | null;
  origin: "session" | "progress";
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
 * skippable. Arrow keys move between cards when no text field has focus.
 */
export function ReportScreen({
  sessionId,
  initial,
  origin,
  navigate,
}: ReportScreenProps): ReactNode {
  const { t } = useTranslation();
  const [report, setReport] = useState<Report | null>(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
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
  }, [total]);

  const leave = (): void => {
    navigate(origin === "progress" ? { name: "progress" } : { name: "home" });
  };

  if (report === null) {
    return (
      <main className="grid h-full place-items-center">
        {failure === null ? (
          <p className="flex items-center gap-3 text-sm text-ink-faint">
            <Spinner />
            {t("report.loading")}
          </p>
        ) : (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </main>
    );
  }

  const step = steps[index] ?? steps[0];
  const onlyClosing = report.cards.length === 0;

  const closing = (focusPatternId: string | null): ReactNode => (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <CardTitle>{t("report.closing.title")}</CardTitle>
        <p className="text-lead text-ink-soft">
          {onlyClosing ? t("report.empty") : t("report.closing.body")}
        </p>
      </div>
      <div className="flex flex-col items-start gap-3">
        {focusPatternId !== null && (
          <Button
            variant="primary"
            size="lg"
            icon={<Dumbbell aria-hidden className="size-5" />}
            onClick={() => {
              navigate({
                name: "practice",
                patternId: focusPatternId,
                format: null,
                autostart: true,
              });
            }}
          >
            {t("report.closing.practise")}
          </Button>
        )}
        <div className="flex gap-2">
          <Button
            icon={<MessageCircle aria-hidden className="size-4" />}
            onClick={() => {
              navigate({ name: "setup", preset: null });
            }}
          >
            {t("report.closing.another")}
          </Button>
          <Button variant="ghost" onClick={leave}>
            {t("report.closing.done")}
          </Button>
        </div>
      </div>
    </div>
  );

  const render = (current: Step): ReactNode => {
    switch (current.kind) {
      case "achievement":
        return <AchievementCard card={current.card} />;
      case "focus":
        return (
          <div className="flex flex-col gap-8">
            <CardTitle>{t("report.focus.title")}</CardTitle>
            <CorrectionView card={current.card} />
          </div>
        );
      case "minors":
        return (
          <div className="flex flex-col gap-8">
            <CardTitle>
              {t("report.minor.title", { count: current.cards.length })}
            </CardTitle>
            <div className="flex flex-col divide-y divide-line">
              {current.cards.map((card) => (
                <div key={card.itemId} className="py-6 first:pt-0 last:pb-0">
                  <CorrectionView card={card} compact />
                </div>
              ))}
            </div>
          </div>
        );
      case "couldHaveSaid":
        return <CouldHaveSaidCard card={current.card} />;
      case "vocabulary":
        return <VocabularyCard card={current.card} />;
      case "metrics":
        return <MetricsCard card={current.card} />;
      case "challenge":
        return <ChallengeCard card={current.card} />;
      case "closing":
        return closing(current.focusPatternId);
      default:
        return null;
    }
  };

  const last = index >= total - 1;

  return (
    <main aria-label={t("report.label")} className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-6 px-8">
        <ol aria-hidden className="flex flex-1 gap-1.5">
          {steps.map((item, i) => (
            <li
              key={`${item.kind}-${i}`}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                i <= index ? "bg-accent" : "bg-line",
              )}
            />
          ))}
        </ol>
        <p className="text-sm text-ink-faint tabular-nums">
          {t("report.step", { current: index + 1, total })}
        </p>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={leave}
          className="grid size-9 place-items-center rounded-md text-ink-faint hover:bg-raised hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      </header>
      <p className="sr-only">{t("report.keys")}</p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section
          key={index}
          aria-roledescription="slide"
          aria-label={t("report.step", { current: index + 1, total })}
          className="mx-auto max-w-2xl px-10 pt-10 pb-12 motion-safe:animate-rise"
        >
          {step === undefined ? null : render(step)}
        </section>
      </div>

      <footer className="flex h-20 shrink-0 items-center justify-between border-t border-line px-8">
        <Button
          variant="ghost"
          disabled={index === 0}
          aria-label={t("report.previous")}
          icon={<ArrowLeft aria-hidden className="size-4" />}
          onClick={() => {
            setIndex((held) => Math.max(held - 1, 0));
          }}
        />
        {!last && (
          <Button
            variant="primary"
            onClick={() => {
              setIndex((held) => Math.min(held + 1, total - 1));
            }}
          >
            {t("report.next")}
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        )}
      </footer>
    </main>
  );
}
