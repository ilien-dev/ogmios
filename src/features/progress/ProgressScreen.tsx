import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Progress, VocabEntry } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { StrengthMark } from "@/features/recall/StrengthMark";
import { errorMessage } from "@/lib/errors";
import { deleteSession, getProgress } from "@/lib/ipc";
import { formatDate } from "@/lib/text";
import { focusPattern } from "./ladder";
import { ProgressBoard } from "./ProgressBoard";
import { ProgressScene } from "./ProgressScene";
import { SessionList } from "./SessionList";

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
    <Reveal
      as="section"
      className={cn("flex flex-col gap-5 rounded-xl glass p-6", className)}
    >
      <h2 className="font-display text-2xl font-light tracking-tight text-ink">
        {title}
      </h2>
      <Presence swap>
        {empty === null ? (
          <Reveal key="filled" kind="fade" index={0}>
            {children}
          </Reveal>
        ) : (
          <Reveal
            key="empty"
            as="p"
            kind="fade"
            index={0}
            className="text-ink-soft"
          >
            {empty}
          </Reveal>
        )}
      </Presence>
    </Reveal>
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
        <Presence>
          {shown.map((word, index) => (
            <Reveal
              key={`${word.date}-${word.english}-${word.asked ?? ""}`}
              kind="fade"
              index={index}
              className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0"
            >
              <dt className="flex items-center gap-2 font-medium text-ink">
                {word.english}
                <Presence>
                  {word.strength !== null && (
                    <Reveal key="strength" as="span" kind="fade">
                      <StrengthMark strength={word.strength} />
                    </Reveal>
                  )}
                </Presence>
              </dt>
              <dd className="truncate text-sm text-ink-faint">
                {word.asked ?? ""}
              </dd>
            </Reveal>
          ))}
        </Presence>
      </dl>
      <Presence>
        {shown.length < words.length && (
          <Reveal key="words" as="span" kind="fade">
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
          </Reveal>
        )}
      </Presence>
    </div>
  );
}

/**
 * §11: the progress map, as in the brand proposal: a column of glass beside
 * the staircase of patterns, and below them the level, the best sentences,
 * the words and the conversations. Levels live here and nowhere else.
 */
export function ProgressScreen({
  navigate,
}: {
  navigate: Navigate;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

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

  const view = (): ReactNode => {
    if (progress === null) {
      return (
        <main className="grid h-full place-items-center">
          <Presence swap>
            {failure === null ? (
              <Reveal key="waiting" as="span" kind="fade">
                <Spinner />
              </Reveal>
            ) : (
              <Notice key="failure" tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            )}
          </Presence>
        </main>
      );
    }

    const cefr = progress.cefrHistory.at(-1);
    const locale = i18n.language;
    const shown =
      progress.patterns.find((pattern) => pattern.id === picked) ??
      focusPattern(progress.patterns);

    return (
      <main className="h-full overflow-y-auto">
        <div className="flex flex-col gap-4 pt-2 pb-6">
          <div className="flex flex-col gap-4 wide:flex-row wide:items-stretch">
            <div className="flex w-full shrink-0 flex-col wide:max-w-md">
              <ProgressBoard
                progress={progress}
                selected={shown?.id ?? null}
                onSelect={setPicked}
              />
            </div>
            <Stagger className="flex min-h-195 min-w-0 flex-1 flex-col">
              <ProgressScene
                progress={progress}
                shown={shown}
                className="flex-1"
              />
            </Stagger>
          </div>

          <Stagger className="grid gap-4 wide:grid-cols-2">
            <Section
              title={t("progress.cefr")}
              empty={cefr === undefined ? t("progress.cefrEmpty") : null}
            >
              <div className="flex flex-col gap-4">
                <p className="font-display text-6xl leading-none font-light tracking-tight text-ink tabular-nums">
                  {cefr?.cefr}
                </p>
                <ol className="flex flex-wrap gap-2">
                  <Presence>
                    {progress.cefrHistory.map((point, index) => (
                      <Reveal
                        key={point.date}
                        as="li"
                        kind="fade"
                        index={index}
                        className="rounded-full glass px-3 py-1 font-mono text-xs text-ink-soft tabular-nums"
                      >
                        {`${formatDate(point.date, locale)} · ${point.cefr}`}
                      </Reveal>
                    ))}
                  </Presence>
                </ol>
                <p className="text-sm text-ink-soft">
                  {t("progress.cefrNote")}
                </p>
              </div>
            </Section>
            <Section
              title={t("progress.best")}
              empty={
                progress.bestSentences.length === 0
                  ? t("progress.bestEmpty")
                  : null
              }
            >
              <ul className="flex flex-col gap-5">
                <Presence>
                  {progress.bestSentences.map((sentence) => (
                    <Reveal
                      key={`${sentence.date}-${sentence.text}`}
                      as="li"
                      kind="fade"
                      index={0}
                      className="flex flex-col gap-1 border-l-2 border-mint pl-4"
                    >
                      <p className="leading-relaxed text-ink">
                        {sentence.text}
                      </p>
                      <p className="font-mono text-xs text-ink-faint">
                        {formatDate(sentence.date, locale)}
                      </p>
                    </Reveal>
                  ))}
                </Presence>
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
            <Section
              title={t("progress.sessions")}
              empty={
                progress.sessions.length === 0
                  ? t("progress.sessionsEmpty")
                  : null
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
          </Stagger>
        </div>
      </main>
    );
  };

  return (
    <Swap
      as="div"
      id={progress === null ? "loading" : "ready"}
      className="h-full"
    >
      {view()}
    </Swap>
  );
}
