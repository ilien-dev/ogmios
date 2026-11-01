import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TranslationParagraph } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { PastRow, SessionRow, WritingRow } from "./TranslateRows";
import { isWhole } from "./useTranslationRun";
import type { TranslationRun } from "./useTranslationRun";

/** How many paragraphs just translated stay in sight, when they fit. */
const PAST_SHOWN = 2;
/** A paragraph kept to be measured: not to be read. */
const OUT_OF_SIGHT = "pointer-events-none invisible absolute inset-x-0 top-0";

/** The rows of the list that are in it for good, not on their way out. */
function standing(list: HTMLElement | null, mark: string): HTMLElement[] {
  return [...(list?.querySelectorAll<HTMLElement>(`[${mark}]`) ?? [])].filter(
    (row) => !row.hasAttribute("inert"),
  );
}

interface TranslateSessionProps {
  run: TranslationRun;
  native: string;
}

/**
 * A running attempt: the paragraph being translated, and above it the last
 * two translated, each with its score and its marks. The one being written
 * comes first: the ones above stay only while they fit over it, the older
 * one going first. When a paragraph is whole the next one comes in below,
 * and the oldest in sight lifts away upwards.
 */
export function TranslateSession({
  run,
  native,
}: TranslateSessionProps): ReactNode {
  const { t } = useTranslation();
  const { translation } = run;
  const { current, paragraphs, total, direction } = translation;
  const done = paragraphs.filter(isWhole);
  const being = paragraphs.find((each) => each.index === current);
  const recent = done.slice(-PAST_SHOWN);

  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [fit, setFit] = useState(PAST_SHOWN);
  const [, setResized] = useState(0);

  useEffect(() => {
    const resized = (): void => {
      setResized((times) => times + 1);
    };
    globalThis.addEventListener("resize", resized);
    return () => {
      globalThis.removeEventListener("resize", resized);
    };
  }, []);

  // Measured at every render, before it is painted: what is written, the
  // reviews that arrive and the window all change how much fits. A row on
  // its way out is no longer counted.
  useLayoutEffect(() => {
    const [writing] = standing(list.current, "data-writing");
    let room = (box.current?.clientHeight ?? 0) - (writing?.offsetHeight ?? 0);
    let count = 0;
    for (const row of standing(list.current, "data-past").reverse()) {
      if (row.offsetHeight > room) {
        break;
      }
      room -= row.offsetHeight;
      count += 1;
    }
    setFit(count);
  });

  const past = (paragraph: TranslationParagraph, at: number): ReactNode => (
    <PastRow
      key={`paragraph-${String(paragraph.index)}`}
      paragraph={paragraph}
      failure={run.unreviewed.get(paragraph.index) ?? null}
      onReviewAgain={() => {
        run.reviewAgain(paragraph.index);
      }}
      away={recent.length - 1 - at < fit ? undefined : OUT_OF_SIGHT}
    />
  );

  const finished = done.length === total;
  return (
    <div
      ref={box}
      className="flex min-h-0 flex-1 flex-col justify-end overflow-x-hidden overflow-y-auto"
    >
      <ul ref={list} className="relative flex flex-col gap-3">
        <Presence>
          {recent.map(past)}
          {being?.source === null && (
            <SessionRow
              key="preparing"
              data-writing
              className="flex flex-wrap items-center gap-3 py-6 text-ink-soft"
            >
              <Presence swap>
                {run.unprepared ? (
                  <Reveal
                    key="failed"
                    className="flex flex-wrap items-center gap-3"
                  >
                    {t("books.translate.prepareFailed")}
                    <Button size="sm" onClick={run.prepareAgain}>
                      {t("common.retry")}
                    </Button>
                  </Reveal>
                ) : (
                  <Reveal
                    key="preparing"
                    className="flex flex-wrap items-center gap-3"
                  >
                    <Spinner />
                    {t("books.translate.preparing", { language: native })}
                  </Reveal>
                )}
              </Presence>
            </SessionRow>
          )}
          {being !== undefined && being.source !== null && (
            <WritingRow
              key={`paragraph-${String(being.index)}`}
              paragraph={being}
              source={being.source}
              english={direction === "toNative"}
              onWrite={(sentence, text) =>
                run.write(being.index, sentence, text)
              }
            />
          )}
          {being === undefined && (
            <SessionRow
              key="finished"
              data-writing
              className="flex flex-col gap-2 py-6"
            >
              <h2 className="text-lead font-semibold text-ink">
                {finished
                  ? t(
                      direction === "toNative"
                        ? "books.translate.finished"
                        : "books.translate.finishedBack",
                    )
                  : t("books.translate.caughtUp")}
              </h2>
              <p className="text-ink-soft">
                {finished
                  ? t("books.translate.finishedHint")
                  : t("books.translate.caughtUpHint", { language: native })}
              </p>
            </SessionRow>
          )}
        </Presence>
      </ul>
    </div>
  );
}
