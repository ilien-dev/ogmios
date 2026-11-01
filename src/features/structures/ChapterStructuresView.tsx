import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { BackLink } from "@/components/ui/BackLink";
import { Notice } from "@/components/ui/Notice";
import { errorMessage } from "@/lib/errors";
import { startStructureSitting, structuresState } from "@/lib/ipc";
import { ScanProgress, useChapterScan } from "./ChapterScan";
import { StartBar } from "./StartBar";
import { DEFAULT_SIZE, formOf } from "./structureText";

interface ChapterStructuresViewProps {
  chapterId: string;
  /** Back to where the chapter's structures were opened from. */
  onBack: () => void;
  /** A session on them was started. */
  onStarted: (sittingId: string) => void;
}

/**
 * The structures a chapter uses most, each with a sentence of the book that
 * has it, and the way into a session on them with the chapter's own words.
 * The first time it is opened the chapter is read for them, which takes a
 * moment; after that they are kept.
 */
export function ChapterStructuresView({
  chapterId,
  onBack,
  onStarted,
}: ChapterStructuresViewProps): ReactNode {
  const { t } = useTranslation();
  const { found, progress, failure: unread, read } = useChapterScan(chapterId);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [failure, setFailure] = useState<string | null>(null);
  const [size, setSize] = useState<number>(DEFAULT_SIZE);
  const [starting, setStarting] = useState(false);
  const shown = failure ?? unread;

  useEffect(() => {
    read();
  }, [read]);

  useEffect(() => {
    let live = true;
    structuresState()
      .then((state) => {
        if (live) {
          setNames(
            new Map(state.structures.map((each) => [each.key, each.name])),
          );
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

  const start = async (keys: readonly string[]): Promise<void> => {
    setStarting(true);
    setFailure(null);
    try {
      const sitting = await startStructureSitting(keys, size, chapterId);
      onStarted(sitting.id);
    } catch (error) {
      setFailure(errorMessage(error));
      setStarting(false);
    }
  };

  const keys = found?.structures.map((each) => each.key) ?? [];
  return (
    <main className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Stagger className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12 nav:py-16">
          <Reveal as="header" className="flex flex-col gap-3">
            <BackLink label={t("structures.title")} onClick={onBack} />
            <h1 className="font-display text-display font-light text-ink">
              {t("structures.chapter.screenTitle")}
            </h1>
            <p className="text-lead text-ink-soft">
              {t("structures.chapter.screenIntro")}
            </p>
          </Reveal>
          <Presence>
            {shown !== null && (
              <Notice key="failure" tone="danger">
                {t("common.error", { message: shown })}
              </Notice>
            )}
            {found === null && unread === null && (
              <Reveal key="reading" kind="fade">
                <ScanProgress progress={progress} />
              </Reveal>
            )}
            {found !== null && found.structures.length === 0 && (
              <Reveal as="p" key="none" kind="fade" className="text-ink-soft">
                {t("structures.chapter.none")}
              </Reveal>
            )}
            {found !== null && found.structures.length > 0 && (
              <Reveal key="found">
                <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface py-1 shadow-card">
                  {found.structures.map((each) => (
                    <li
                      key={each.key}
                      className="flex flex-col gap-2 px-5 py-4"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p>
                          <span className="font-medium text-ink">
                            {names.get(each.key) ?? each.key}
                          </span>
                          <span className="text-sm text-ink-soft">
                            {" · "}
                            {formOf(each.key, t)}
                          </span>
                        </p>
                        <p className="text-sm text-ink-faint tabular-nums">
                          {t("structures.chapter.count", { count: each.count })}
                        </p>
                      </div>
                      <Presence>
                        {each.example !== "" && (
                          <Reveal
                            key="example"
                            as="blockquote"
                            className="border-l-2 border-line-strong pl-3 text-sm text-ink-soft italic"
                          >
                            {each.example}
                          </Reveal>
                        )}
                      </Presence>
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}
          </Presence>
        </Stagger>
      </div>
      <Presence>
        {keys.length > 0 && (
          <Reveal key="start" kind="fade" className="shrink-0">
            <StartBar
              size={size}
              onSize={setSize}
              note={t("structures.chapter.words")}
              starting={starting}
              onStart={() => void start(keys)}
            />
          </Reveal>
        )}
      </Presence>
    </main>
  );
}
