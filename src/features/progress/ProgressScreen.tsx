import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Progress, VocabEntry } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { StrengthMark } from "@/features/recall/StrengthMark";
import { errorMessage } from "@/lib/errors";
import { deleteSession, getProgress } from "@/lib/ipc";
import { formatDate } from "@/lib/text";
import { PatternList } from "./PatternList";
import { SessionList } from "./SessionList";
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

/** Words shown before the learner asks for all of them. */
const VOCABULARY_SHOWN = 12;

/**
 * The words learned, the latest first: a few of them, and the rest on
 * request. A book brings them in by the hundred.
 */
function Vocabulary({ words }: { words: VocabEntry[] }): ReactNode {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shown = all ? words : words.slice(0, VOCABULARY_SHOWN);
  return (
    <div className="flex flex-col items-start gap-3">
      <dl className="flex w-full flex-col divide-y divide-line">
        {shown.map((word) => (
          <div
            key={`${word.date}-${word.english}-${word.asked ?? ""}`}
            className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0"
          >
            <dt className="flex items-center gap-2 font-medium text-ink">
              {word.english}
              {word.strength !== null && (
                <StrengthMark strength={word.strength} />
              )}
            </dt>
            <dd className="truncate text-sm text-ink-faint">
              {word.asked ?? ""}
            </dd>
          </div>
        ))}
      </dl>
      {shown.length < words.length && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => {
            setAll(true);
          }}
        >
          {t("progress.vocabularyAll", { count: words.length })}
        </Button>
      )}
    </div>
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
            <Vocabulary words={progress.vocabulary} />
          </Section>
        </div>

        <Section
          title={t("progress.sessions")}
          empty={
            progress.sessions.length === 0 ? t("progress.sessionsEmpty") : null
          }
        >
          <SessionList
            sessions={progress.sessions}
            navigate={navigate}
            onDelete={async (sessionId) => {
              await deleteSession(sessionId);
              setProgress(await getProgress());
            }}
          />
        </Section>
      </div>
    </main>
  );
}
