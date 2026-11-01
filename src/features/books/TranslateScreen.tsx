import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Chapter, Translation } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Stagger } from "@/components/motion/Stagger";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { errorMessage } from "@/lib/errors";
import { closeAttempt, getAttempt } from "@/lib/ipc";
import { languageName } from "@/lib/text";
import { chapterName } from "./chapterName";
import { DetailRow, Summary } from "./TranslateDetail";
import { TranslateBar } from "./TranslateBar";
import { TranslateSession } from "./TranslateSession";
import { TranslateStart } from "./TranslateStart";
import { isWhole, useTranslationRun } from "./useTranslationRun";

interface RunProps {
  /** The attempt as it stood when it was opened. */
  opened: Translation;
  native: string;
  /** The attempt was finished: it is opened again, to be read. */
  onFinished: (attempt: Translation) => void;
  /** The attempt was paused, or a finished one was read. */
  onLeave: () => void;
}

/**
 * One attempt on the screen. While it runs it is a session, with the two
 * ways out always under it: pausing, to go on later, and finishing. Once
 * finished it is read: a summary of what matters most, and then every
 * paragraph in full.
 */
function Run({ opened, native, onFinished, onLeave }: RunProps): ReactNode {
  const { t } = useTranslation();
  const run = useTranslationRun(opened);
  const { translation } = run;
  const [failure, setFailure] = useState<string | null>(null);
  const shown = failure ?? run.failure;
  const written = translation.paragraphs.some(
    (each) => each.written.length > 0,
  );

  /** Pauses the attempt, or finishes it and opens what it came to. */
  const leave = async (finished: boolean): Promise<void> => {
    try {
      await closeAttempt(translation.attemptId, finished);
      // One with nothing written is not kept: there is nothing to read.
      if (finished && written) {
        onFinished(await getAttempt(translation.attemptId));
      } else {
        onLeave();
      }
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const failed = (
    <Presence>
      {shown !== null && (
        <Notice key="failure" tone="danger">
          {t("common.error", { message: shown })}
        </Notice>
      )}
    </Presence>
  );

  if (translation.finished) {
    return (
      <main className="h-full overflow-y-auto">
        <Stagger className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12 nav:px-10 nav:py-16">
          <Reveal as="header" className="flex flex-col gap-3">
            <BackLink label={t("books.translate.attempts")} onClick={onLeave} />
            <h1 className="font-display text-display font-light text-ink">
              {t("books.translate.title")}
            </h1>
          </Reveal>
          <Reveal>
            <TranslateBar translation={translation} native={native} />
          </Reveal>
          {failed}
          <Reveal>
            <Summary translation={translation} failure={run.unsummed} />
          </Reveal>
          <Stagger as="ul" className="flex flex-col gap-3">
            {translation.paragraphs.filter(isWhole).map((paragraph) => (
              <DetailRow
                key={paragraph.index}
                paragraph={paragraph}
                failure={run.unreviewed.get(paragraph.index) ?? null}
                onReviewAgain={() => {
                  run.reviewAgain(paragraph.index);
                }}
                onPractise={(mark) => run.practise(paragraph.index, mark)}
              />
            ))}
          </Stagger>
        </Stagger>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col">
      <Stagger className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-6 px-6 pt-8 nav:px-10 nav:pt-10">
        <Reveal as="header" className="flex flex-col gap-4">
          <h1 className="font-display text-title font-normal text-ink">
            {t("books.translate.title")}
          </h1>
          <TranslateBar translation={translation} native={native} />
        </Reveal>
        {failed}
        <TranslateSession run={run} native={native} />
        <Reveal className="flex gap-3 py-4">
          <Button onClick={() => void leave(false)}>
            {t("books.translate.pause")}
          </Button>
          <Button onClick={() => void leave(true)}>
            {t("books.translate.finish")}
          </Button>
        </Reveal>
      </Stagger>
    </main>
  );
}

interface TranslateScreenProps {
  chapter: Chapter;
  /** The learner's first language: what the chapter is translated into. */
  nativeLang: string;
  /** Back to the chapter. */
  onBack: () => void;
}

/**
 * Translating a chapter: into the learner's language, and then back into
 * English. It is done in attempts, each begun or picked up from the list
 * here; the direction of one holds until it is left.
 */
export function TranslateScreen({
  chapter,
  nativeLang,
  onBack,
}: TranslateScreenProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [opened, setOpened] = useState<Translation | null>(null);
  const native = languageName(nativeLang, i18n.language);

  const view = (): ReactNode => {
    if (opened !== null) {
      return (
        <Run
          opened={opened}
          native={native}
          onFinished={setOpened}
          onLeave={() => {
            setOpened(null);
          }}
        />
      );
    }

    return (
      <main className="h-full overflow-y-auto">
        <Stagger className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 nav:py-16">
          <Reveal as="header" className="flex flex-col gap-3">
            <BackLink label={chapterName(chapter, t)} onClick={onBack} />
            <h1 className="font-display text-display font-light text-ink">
              {t("books.translate.title")}
            </h1>
          </Reveal>
          <Reveal>
            <TranslateStart
              chapterId={chapter.id}
              native={native}
              onOpen={setOpened}
            />
          </Reveal>
        </Stagger>
      </main>
    );
  };

  return (
    <Swap
      as="div"
      id={
        opened === null
          ? "attempts"
          : `${opened.attemptId}-${String(opened.finished)}`
      }
      className="h-full"
    >
      {view()}
    </Swap>
  );
}
