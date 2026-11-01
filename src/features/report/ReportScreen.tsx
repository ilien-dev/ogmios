import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { useScreenLeaving } from "@/lib/motion";
import {
  ArrowLeft,
  ArrowRight,
  Dumbbell,
  MessageCircle,
  X,
} from "lucide-react";
import type { Report } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Orb } from "@/components/ui/Orb";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { errorMessage } from "@/lib/errors";
import { getReport } from "@/lib/ipc";
import { AchievementCard } from "./cards/AchievementCard";
import { CardTitle } from "./cards/CardTitle";
import { ChallengeCard } from "./cards/ChallengeCard";
import { CorrectionView } from "./cards/CorrectionView";
import { CouldHaveSaidCard } from "./cards/CouldHaveSaidCard";
import { MetricsCard } from "./cards/MetricsCard";
import { NativeRewriteCard } from "./cards/NativeRewriteCard";
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
    navigate(origin === "progress" ? { name: "progress" } : { name: "home" });
  };

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
  const onlyClosing = report.cards.length === 0;

  const closing = (focusPatternId: string | null): ReactNode => (
    <Stagger className="flex flex-col gap-8">
      <Reveal className="flex flex-col gap-3">
        <CardTitle>{t("report.closing.title")}</CardTitle>
        <p className="text-lead text-ink-soft">
          {onlyClosing ? t("report.empty") : t("report.closing.body")}
        </p>
      </Reveal>
      <Reveal className="flex flex-wrap items-center gap-3">
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
      </Reveal>
    </Stagger>
  );

  const render = (current: Step): ReactNode => {
    switch (current.kind) {
      case "achievement":
        return <AchievementCard card={current.card} />;
      case "focus":
        return (
          <Stagger className="flex flex-col gap-8">
            <Reveal>
              <CardTitle>{t("report.focus.title")}</CardTitle>
            </Reveal>
            <Reveal>
              <CorrectionView card={current.card} />
            </Reveal>
          </Stagger>
        );
      case "minors":
        return (
          <Stagger className="flex flex-col gap-8">
            <Reveal>
              <CardTitle>
                {t("report.minor.title", { count: current.cards.length })}
              </CardTitle>
            </Reveal>
            {current.cards.map((card) => (
              <Reveal
                key={card.itemId}
                className="rounded-lg bg-raised px-6 py-5"
              >
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
        return closing(current.focusPatternId);
      default:
        return null;
    }
  };

  const last = index >= total - 1;
  const where = t("report.step", { current: index + 1, total });

  return (
    <main aria-label={t("report.label")} className="flex h-full flex-col">
      <Reveal
        as="header"
        kind="fade"
        index={0}
        className="flex shrink-0 items-center gap-4 px-6 py-4 nav:px-10"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Orb size="sm" shared />
          <p className="truncate font-semibold text-ink">{t("report.label")}</p>
        </div>
        <div role="img" aria-label={where} className="flex items-center gap-2">
          {steps.map((item, i) => (
            <span
              key={`${item.kind}-${i}`}
              className="relative size-2 rounded-full bg-line-strong"
            >
              {i === index && (
                <motion.span
                  layoutId="report-dot"
                  className="absolute -inset-1 rounded-full bg-ink"
                />
              )}
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={leave}
          className="grid size-11 place-items-center rounded-full bg-raised text-ink transition-control hover:bg-line"
        >
          <X aria-hidden className="size-5" />
        </button>
      </Reveal>
      <p className="sr-only" aria-live="polite">
        {where}
      </p>
      <p className="sr-only">{t("report.keys")}</p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative mx-auto max-w-3xl px-6 py-2 nav:px-10">
          <Presence swap>
            <Reveal
              key={index}
              as="section"
              aria-roledescription="slide"
              aria-label={where}
              className="rounded-xl bg-surface p-8 shadow-card nav:p-10"
            >
              {step === undefined ? null : render(step)}
            </Reveal>
          </Presence>
        </div>
      </div>

      <Reveal
        kind="fade"
        index={1}
        className="mx-auto flex w-full max-w-3xl shrink-0 items-center justify-between px-6 py-5 nav:px-10"
      >
        <Button
          disabled={index === 0}
          aria-label={t("report.previous")}
          className="size-12 px-0"
          icon={<ArrowLeft aria-hidden className="size-5" />}
          onClick={() => {
            setIndex((held) => Math.max(held - 1, 0));
          }}
        />
        <Presence>
          {!last && (
            <Reveal key="next" as="span" kind="scale" index={0}>
              <Button
                variant="inverse"
                size="lg"
                onClick={() => {
                  setIndex((held) => Math.min(held + 1, total - 1));
                }}
              >
                {t("report.next")}
                <ArrowRight aria-hidden className="size-4" />
              </Button>
            </Reveal>
          )}
        </Presence>
      </Reveal>
    </main>
  );
}
