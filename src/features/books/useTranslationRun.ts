import { useCallback, useEffect, useRef, useState } from "react";
import type { Translation, TranslationParagraph } from "@shared/domain";
import { errorMessage } from "@/lib/errors";
import {
  practiseWord,
  prepareParagraph,
  reviewParagraph,
  summarizeAttempt,
  writeSentence,
} from "@/lib/ipc";

/** Whether every sentence of the paragraph has been written. */
export function isWhole(paragraph: TranslationParagraph): boolean {
  return (
    paragraph.source !== null &&
    paragraph.written.length >= paragraph.source.length
  );
}

/**
 * The attempt as it stands after an answer from Rust. Answers arrive out of
 * order, a review seconds after the sentences written since it was asked
 * for, and nothing here goes back: a review, a version and a sentence that
 * are in are kept, and the paragraph being translated only moves on.
 */
function merged(held: Translation, fresh: Translation): Translation {
  const before = new Map(held.paragraphs.map((each) => [each.index, each]));
  const paragraphs = fresh.paragraphs.map((each) => {
    const was = before.get(each.index);
    if (was === undefined) {
      return each;
    }
    return {
      ...each,
      source: each.source ?? was.source,
      written:
        each.written.length >= was.written.length ? each.written : was.written,
      review: each.review ?? was.review,
    };
  });
  const current =
    held.current === null || fresh.current === null
      ? null
      : Math.max(held.current, fresh.current);
  return {
    ...fresh,
    paragraphs,
    current,
    score: fresh.score ?? held.score,
    summary: fresh.summary ?? held.summary,
  };
}

/**
 * Has the version of a paragraph just translated written ahead, so the way
 * back opens without a wait. If it fails it is written when the learner
 * gets there.
 */
function writeAhead(state: Translation, paragraph: number): void {
  if (state.direction === "toNative") {
    void prepareParagraph(state.attemptId, paragraph).catch(() => null);
  }
}

export interface TranslationRun {
  translation: Translation;
  /** Why a sentence could not be kept. */
  failure: string | null;
  /** Why the review of a paragraph could not be written, by its index. */
  unreviewed: ReadonlyMap<number, string>;
  /** The version of the paragraph being translated could not be written. */
  unprepared: boolean;
  /** Keeps one sentence; whether it was kept. */
  write: (
    paragraph: number,
    sentence: number,
    text: string,
  ) => Promise<boolean>;
  /** Asks again for a review that failed. */
  reviewAgain: (paragraph: number) => void;
  /** Asks again for the version that failed. */
  prepareAgain: () => void;
  /** Why the summary of a finished attempt could not be written. */
  unsummed: string | null;
  /** Adds the word of a mark of a paragraph to the chapter's practice. */
  practise: (paragraph: number, mark: number) => Promise<void>;
}

/**
 * One attempt on the screen, from how it stood when it was opened. A
 * paragraph is sent to be reviewed as soon as it is whole, and the learner
 * is not made to wait for it; back into English, the paragraph being
 * translated has its version written when it has none. A finished attempt
 * is summed up once every paragraph it has whole is reviewed.
 */
export function useTranslationRun(opened: Translation): TranslationRun {
  const [translation, setTranslation] = useState(opened);
  const [failure, setFailure] = useState<string | null>(null);
  const [unreviewed, setUnreviewed] = useState<Map<number, string>>(new Map());
  const [unprepared, setUnprepared] = useState(false);
  const [unsummed, setUnsummed] = useState<string | null>(null);
  /** What has been asked of Claude already: each is asked once. */
  const asked = useRef<Set<string>>(new Set());
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const take = useCallback((fresh: Translation): void => {
    if (live.current) {
      setTranslation((held) => merged(held, fresh));
    }
  }, []);

  const review = useCallback(
    (state: Translation, paragraph: number): void => {
      reviewParagraph(state.attemptId, paragraph)
        .then((fresh) => {
          take(fresh);
          writeAhead(state, paragraph);
        })
        .catch((error: unknown) => {
          if (live.current) {
            setUnreviewed((held) =>
              new Map(held).set(paragraph, errorMessage(error)),
            );
          }
        });
    },
    [take],
  );

  const prepare = useCallback(
    (state: Translation, paragraph: number): void => {
      prepareParagraph(state.attemptId, paragraph)
        .then(take)
        .catch(() => {
          if (live.current) {
            setUnprepared(true);
          }
        });
    },
    [take],
  );

  useEffect(() => {
    for (const each of translation.paragraphs) {
      const whole = isWhole(each) && each.review === null;
      const bare = each.index === translation.current && each.source === null;
      const key = `${whole ? "review" : "prepare"}-${String(each.index)}`;
      if ((whole || bare) && !asked.current.has(key)) {
        asked.current.add(key);
        if (whole) {
          review(translation, each.index);
        } else {
          prepare(translation, each.index);
        }
      }
    }
  }, [translation, review, prepare]);

  useEffect(() => {
    const whole = translation.paragraphs.filter(isWhole);
    const settled = whole.every(
      (each) => each.review !== null || unreviewed.has(each.index),
    );
    const due = translation.finished && translation.summary === null;
    if (due && settled && !asked.current.has("summary")) {
      asked.current.add("summary");
      summarizeAttempt(translation.attemptId)
        .then(take)
        .catch((error: unknown) => {
          if (live.current) {
            setUnsummed(errorMessage(error));
          }
        });
    }
  }, [translation, unreviewed, take]);

  const write = async (
    paragraph: number,
    sentence: number,
    text: string,
  ): Promise<boolean> => {
    setFailure(null);
    try {
      take(
        await writeSentence(translation.attemptId, paragraph, sentence, text),
      );
      return true;
    } catch (error) {
      if (live.current) {
        setFailure(errorMessage(error));
      }
      return false;
    }
  };

  return {
    translation,
    failure,
    unreviewed,
    unprepared,
    write,
    reviewAgain: (paragraph) => {
      setUnreviewed(
        (held) => new Map([...held].filter(([each]) => each !== paragraph)),
      );
      review(translation, paragraph);
    },
    unsummed,
    practise: async (paragraph, mark) => {
      setFailure(null);
      try {
        take(await practiseWord(translation.attemptId, paragraph, mark));
      } catch (error) {
        if (live.current) {
          setFailure(errorMessage(error));
        }
      }
    },
    prepareAgain: () => {
      if (translation.current !== null) {
        setUnprepared(false);
        prepare(translation, translation.current);
      }
    },
  };
}
