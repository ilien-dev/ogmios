import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { Progress } from "@shared/domain";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { getProgress } from "@/lib/ipc";
import { formatDate } from "@/lib/text";
import { PatternList } from "./PatternList";
import { WeeklyBars } from "./WeeklyBars";

function Section({
  title,
  empty,
  children,
  className,
}: {
  title: string;
  empty: string | null;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <section className={cn("flex flex-col gap-5", className)}>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {empty === null ? children : <p className="text-ink-soft">{empty}</p>}
    </section>
  );
}

/** §11: the progress map. Levels live here and nowhere else. */
export function ProgressScreen({
  navigate,
}: {
  navigate: Navigate;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getProgress()
      .then((loaded) => {
        if (live) {
          setProgress(loaded);
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
  }, []);

  if (progress === null) {
    return (
      <main className="grid h-full place-items-center">
        {failure === null ? (
          <Spinner />
        ) : (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </main>
    );
  }

  const cefr = progress.cefrHistory.at(-1);
  const locale = i18n.language;

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-16 px-10 pt-16 pb-20">
        <h1 className="text-display font-semibold text-ink">
          {t("progress.title")}
        </h1>

        <div className="grid grid-cols-5 gap-12">
          <Section
            title={t("progress.cefr")}
            empty={cefr === undefined ? t("progress.cefrEmpty") : null}
            className="col-span-2"
          >
            <div className="flex flex-col gap-4">
              <p className="text-6xl font-semibold tracking-tight text-ink">
                {cefr?.cefr}
              </p>
              <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-faint">
                {progress.cefrHistory.map((point) => (
                  <li key={point.date} className="tabular-nums">
                    {`${formatDate(point.date, locale)} · ${point.cefr}`}
                  </li>
                ))}
              </ol>
              <p className="text-sm text-ink-soft">{t("progress.cefrNote")}</p>
            </div>
          </Section>
          <Section
            title={t("progress.weekly")}
            empty={
              progress.weeklyMinutes.some((week) => week.minutes > 0)
                ? null
                : t("progress.weeklyEmpty")
            }
            className="col-span-3"
          >
            <WeeklyBars weeks={progress.weeklyMinutes} />
          </Section>
        </div>

        <Section
          title={t("progress.patterns")}
          empty={
            progress.patterns.length === 0 ? t("progress.patternsEmpty") : null
          }
        >
          <PatternList patterns={progress.patterns} />
        </Section>

        <div className="grid grid-cols-2 gap-12">
          <Section
            title={t("progress.best")}
            empty={
              progress.bestSentences.length === 0
                ? t("progress.bestEmpty")
                : null
            }
          >
            <ul className="flex flex-col gap-5">
              {progress.bestSentences.map((sentence) => (
                <li
                  key={`${sentence.date}-${sentence.text}`}
                  className="flex flex-col gap-1"
                >
                  <p className="leading-relaxed text-ink">{sentence.text}</p>
                  <p className="text-sm text-ink-faint">
                    {formatDate(sentence.date, locale)}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
          <Section
            title={t("progress.vocabulary")}
            empty={
              progress.vocabulary.length === 0
                ? t("progress.vocabularyEmpty")
                : null
            }
          >
            <dl className="flex flex-col divide-y divide-line">
              {progress.vocabulary.map((word) => (
                <div
                  key={`${word.date}-${word.english}`}
                  className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0"
                >
                  <dt className="font-medium text-ink">{word.english}</dt>
                  <dd className="truncate text-sm text-ink-faint">
                    {word.asked ?? ""}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>

        <Section
          title={t("progress.sessions")}
          empty={
            progress.sessions.length === 0 ? t("progress.sessionsEmpty") : null
          }
        >
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {progress.sessions.map((session) => {
              const meta = [
                formatDate(session.startedAt, locale),
                t(`mode.${session.mode}`),
                t(`level.${session.level}`),
                t("common.minutes", {
                  count: Math.round(session.speechMinutes),
                }),
              ].join(" · ");
              return (
                <li key={session.id}>
                  {session.hasReport ? (
                    <button
                      type="button"
                      onClick={() => {
                        navigate({
                          name: "report",
                          sessionId: session.id,
                          report: null,
                          origin: "progress",
                        });
                      }}
                      className="group flex w-full items-center gap-4 px-2 py-4 text-left hover:bg-raised"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-ink">
                          {session.topic}
                        </span>
                        <span className="text-sm text-ink-faint">{meta}</span>
                      </span>
                      <span className="flex items-center gap-1 text-sm text-accent-text">
                        {t("progress.viewReport")}
                        <ChevronRight aria-hidden className="size-4" />
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-4 px-2 py-4">
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-ink">
                          {session.topic}
                        </span>
                        <span className="text-sm text-ink-faint">{meta}</span>
                      </span>
                      <span className="text-sm text-ink-faint">
                        {t("progress.noReport")}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </main>
  );
}
