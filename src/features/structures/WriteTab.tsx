import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChapterStructures, StructureInfo } from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import type { Navigate } from "@/app/routes";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { errorMessage } from "@/lib/errors";
import { startStructureSitting, structuresState } from "@/lib/ipc";
import { ScanProgress, useChapterScan } from "./ChapterScan";
import { StartBar } from "./StartBar";
import { DEFAULT_SIZE, formOf } from "./structureText";

/** What the tab shows, by where the chapter's structures stand. */
type Mode = "unprepared" | "loading" | "found" | "none" | "reading" | "ask";

function modeOf(at: {
  prepared: boolean;
  loaded: boolean;
  /** The chapter was read for its structures. */
  read: boolean;
  /** It uses some of them. */
  any: boolean;
  reading: boolean;
}): Mode {
  if (!at.prepared) {
    return "unprepared";
  }
  if (!at.loaded) {
    return "loading";
  }
  if (at.read) {
    return at.any ? "found" : "none";
  }
  return at.reading ? "reading" : "ask";
}

interface WriteTabProps {
  /** The chapter the learner is on. */
  chapterId: string;
  /** Its words were taken: a session asks its sentences with them. */
  prepared: boolean;
  navigate: Navigate;
}

/**
 * Writing with the chapter the learner is on: the structures it uses most,
 * each with a sentence of the book that has it, and the way into a session
 * on them with the chapter's own words. A chapter is read for them once, when
 * the learner asks, since that asks the model; after that they are kept.
 */
export function WriteTab({
  chapterId,
  prepared,
  navigate,
}: WriteTabProps): ReactNode {
  const { t } = useTranslation();
  const scan = useChapterScan(chapterId);
  const [catalogue, setCatalogue] = useState<readonly StructureInfo[]>([]);
  /** What was kept of an earlier reading; null when it was never read. */
  const [kept, setKept] = useState<ChapterStructures | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [size, setSize] = useState<number>(DEFAULT_SIZE);
  const [starting, setStarting] = useState(false);
  const names = new Map(catalogue.map((each) => [each.key, each.name]));

  useEffect(() => {
    let live = true;
    structuresState()
      .then((state) => {
        if (live) {
          setCatalogue(state.structures);
          const { chapter } = state;
          setKept(
            chapter !== null &&
              chapter.chapter.id === chapterId &&
              chapter.scanned
              ? chapter
              : null,
          );
          setLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [chapterId]);

  const start = async (keys: readonly string[]): Promise<void> => {
    setStarting(true);
    setFailure(null);
    try {
      const sitting = await startStructureSitting(keys, size, chapterId);
      navigate({ name: "structures", running: sitting.id });
    } catch (error) {
      setFailure(errorMessage(error));
      setStarting(false);
    }
  };

  const found = scan.found ?? kept;
  const shown = failure ?? scan.failure;
  const keys = found?.structures.map((each) => each.key) ?? [];
  const mode = modeOf({
    prepared,
    loaded,
    read: found !== null,
    any: keys.length > 0,
    reading: scan.reading,
  });
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-medium tracking-tight text-ink">
          {t("structures.chapter.screenTitle")}
        </h2>
        <p className="max-w-prose text-sm text-ink-soft">
          {t("structures.chapter.screenIntro")}
        </p>
      </header>
      <Presence>
        {shown !== null && (
          <Notice key="failure" tone="danger">
            {t("common.error", { message: shown })}
          </Notice>
        )}
      </Presence>
      <div className="relative">
        <Presence swap>
          {mode === "unprepared" && (
            <Reveal
              key="unprepared"
              kind="fade"
              className="flex flex-col items-start gap-3"
            >
              <p className="text-ink-soft">
                {t("structures.chapter.unprepared")}
              </p>
              <Button
                onClick={() => {
                  navigate({ name: "book", tab: "words" });
                }}
              >
                {t("structures.chapter.toWords")}
              </Button>
            </Reveal>
          )}
          {mode === "ask" && (
            <Reveal
              key="ask"
              kind="fade"
              className="flex flex-col items-start gap-3"
            >
              <p className="text-sm text-ink-soft">
                {t("structures.chapter.findHint")}
              </p>
              <Button variant="primaryBook" onClick={scan.read}>
                {t("structures.chapter.find")}
              </Button>
            </Reveal>
          )}
          {mode === "reading" && (
            <Reveal key="reading" kind="fade">
              <ScanProgress progress={scan.progress} />
            </Reveal>
          )}
          {mode === "none" && (
            <Reveal as="p" key="none" kind="fade" className="text-ink-soft">
              {t("structures.chapter.none")}
            </Reveal>
          )}
          {mode === "found" && (
            <Reveal key="found" kind="fade" className="flex flex-col gap-4">
              <Stagger
                as="ul"
                className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface/60 py-1"
              >
                {(found?.structures ?? []).map((each) => (
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
              <StartBar
                size={size}
                onSize={setSize}
                note={t("structures.chapter.words")}
                starting={starting}
                onStart={() => void start(keys)}
              />
              <button
                type="button"
                onClick={() => {
                  navigate({ name: "progress", tab: "structures" });
                }}
                className="self-start text-sm font-semibold text-accent-text underline-offset-4 hover:underline"
              >
                {t("structures.chapter.catalogue")}
              </button>
            </Reveal>
          )}
        </Presence>
      </div>
    </div>
  );
}
