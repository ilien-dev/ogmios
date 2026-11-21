import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { StructureInfo } from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { BackLink } from "@/components/ui/BackLink";
import { Notice } from "@/components/ui/Notice";
import { StatChip } from "@/components/scene/Stats";
import { HubScreen } from "@/features/drills/ScreenParts";
import { errorMessage } from "@/lib/errors";
import { startStructureSitting, structuresState } from "@/lib/ipc";
import { ScanProgress, useChapterScan } from "./ChapterScan";
import { LevelScene } from "./LevelScene";
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
  const [catalogue, setCatalogue] = useState<readonly StructureInfo[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [size, setSize] = useState<number>(DEFAULT_SIZE);
  const [starting, setStarting] = useState(false);
  const shown = failure ?? unread;
  const names = new Map(catalogue.map((each) => [each.key, each.name]));

  useEffect(() => {
    read();
  }, [read]);

  useEffect(() => {
    let live = true;
    structuresState()
      .then((state) => {
        if (live) {
          setCatalogue(state.structures);
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
  const sentences =
    found?.structures.reduce((sum, each) => sum + each.count, 0) ?? 0;
  return (
    <HubScreen
      aside={
        <>
          <Reveal className="flex flex-col gap-3">
            <BackLink label={t("structures.title")} onClick={onBack} />
            <div className="flex flex-wrap gap-2">
              <StatChip value={keys.length} tone="accent">
                {t("structures.board.structures", { count: keys.length })}
              </StatChip>
              <StatChip value={sentences}>
                {t("structures.board.sentences", { count: sentences })}
              </StatChip>
            </div>
          </Reveal>
          <Presence>
            {found === null && unread === null && (
              <Reveal
                key="reading"
                kind="fade"
                className="rounded-xl glass p-5"
              >
                <ScanProgress progress={progress} />
              </Reveal>
            )}
            {found !== null && found.structures.length === 0 && (
              <Reveal
                as="p"
                key="none"
                kind="fade"
                className="rounded-xl glass p-5 text-ink-soft"
              >
                {t("structures.chapter.none")}
              </Reveal>
            )}
            {found !== null && found.structures.length > 0 && (
              <Reveal key="found">
                <Stagger
                  as="ul"
                  className="flex flex-col divide-y divide-line rounded-xl glass py-1"
                >
                  {found.structures.map((each) => (
                    <Reveal
                      as="li"
                      key={each.key}
                      kind="fade"
                      className="flex flex-col gap-2 px-5 py-4"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p>
                          <span className="font-display font-medium tracking-tight text-ink">
                            {names.get(each.key) ?? each.key}
                          </span>
                          <span className="text-sm text-ink-soft">
                            {" · "}
                            {formOf(each.key, t)}
                          </span>
                        </p>
                        <p className="font-mono text-xs text-ink-faint tabular-nums">
                          {t("structures.chapter.count", { count: each.count })}
                        </p>
                      </div>
                      <Presence>
                        {each.example !== "" && (
                          <Reveal
                            key="example"
                            as="blockquote"
                            className="border-l-2 border-book/40 pl-3 text-sm text-ink-soft"
                          >
                            {each.example}
                          </Reveal>
                        )}
                      </Presence>
                    </Reveal>
                  ))}
                </Stagger>
              </Reveal>
            )}
          </Presence>
        </>
      }
      scene={
        <LevelScene
          title={t("structures.chapter.screenTitle")}
          text={t("structures.chapter.screenIntro")}
          structures={catalogue}
          picked={new Set(keys)}
          extra={
            <Presence>
              {shown !== null && (
                <Notice key="failure" tone="danger">
                  {t("common.error", { message: shown })}
                </Notice>
              )}
            </Presence>
          }
          footer={
            <Presence>
              {keys.length > 0 && (
                <Reveal key="start" kind="fade">
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
          }
        />
      }
    />
  );
}
