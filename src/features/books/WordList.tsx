import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BookWord } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { STAGGER_LIMIT } from "@/lib/motion";
import { Button } from "@/components/ui/Button";
import { Tally } from "./Tally";
import { WordRow } from "./WordRow";

interface WordListProps {
  words: BookWord[];
  /** The learner knows this word already, or takes that back. */
  onKnown: (word: BookWord, known: boolean) => void;
  /** Sort the words still to learn, when there is a list to clear. */
  onTriage?: (() => void) | undefined;
}

/**
 * The chapter's words: each with the kind of word it is, its translations and
 * its count, and a way to say "I know this". A word finished one way alone
 * shows it there, and says on hover which way is still to come; a learned
 * one shows how strong it is in the daily recall. The words set
 * aside as known stay below, folded, so that any of them can be taken back.
 */
export function WordList({
  words,
  onKnown,
  onTriage,
}: WordListProps): ReactNode {
  const { t } = useTranslation();
  if (words.length === 0) {
    return (
      <Reveal as="p" kind="fade" className="text-ink-soft">
        {t("books.chapter.noWords")}
      </Reveal>
    );
  }
  const toLearn = words.filter((word) => !word.known);
  const known = words.filter((word) => word.known);
  const open = toLearn.filter((word) => !word.done).length;
  return (
    <div className="flex w-full flex-col gap-6">
      <Presence>
        {open > 0 && (
          <Reveal
            key="open"
            kind="fade"
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
          >
            <Tally dot="bg-line-strong">
              {t("books.chapter.wordCount", { count: open })}
            </Tally>
            <Presence>
              {onTriage !== undefined && (
                <Reveal key="onTriage" as="span" kind="fade">
                  <Button size="sm" onClick={onTriage}>
                    {t("books.triage.start")}
                  </Button>
                </Reveal>
              )}
            </Presence>
          </Reveal>
        )}
      </Presence>
      <Presence>
        {toLearn.length > 0 && (
          <Reveal key="table" kind="fade">
            <table className="w-full text-left">
              <thead className="border-b border-line text-sm text-ink-faint">
                <tr>
                  <th scope="col" className="p-2 font-medium">
                    {t("books.chapter.word")}
                  </th>
                  <th scope="col" className="p-2 font-medium">
                    {t("books.chapter.translation")}
                  </th>
                  <th scope="col" className="p-2 text-right font-medium">
                    {t("books.chapter.count")}
                  </th>
                  <th scope="col" className="p-2 text-right font-medium">
                    {t("books.chapter.known")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <Presence>
                  {toLearn.map((word, index) => (
                    <WordRow
                      key={word.id}
                      word={word}
                      index={index}
                      onKnown={onKnown}
                    />
                  ))}
                </Presence>
              </tbody>
            </table>
          </Reveal>
        )}
      </Presence>
      <Presence>
        {known.length > 0 && (
          <Reveal key="known" kind="fade">
            <details className="text-sm text-ink-soft">
              <summary className="cursor-pointer py-1 text-ink-faint hover:text-ink">
                {t("books.chapter.knownCount", { count: known.length })}
              </summary>
              <ul className="flex flex-col divide-y divide-line pt-2">
                <Presence>
                  {known.map((word, index) => (
                    <Reveal
                      key={word.id}
                      as="li"
                      kind="fade"
                      index={index}
                      layout={index < STAGGER_LIMIT ? "position" : false}
                      className="flex items-center gap-4 px-2 py-1"
                    >
                      <span className="font-medium">{word.lemma}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-faint">
                        {word.translations.join(", ")}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("books.chapter.undoWord", {
                          word: word.lemma,
                        })}
                        onClick={() => {
                          onKnown(word, false);
                        }}
                      >
                        {t("books.chapter.undo")}
                      </Button>
                    </Reveal>
                  ))}
                </Presence>
              </ul>
            </details>
          </Reveal>
        )}
      </Presence>
    </div>
  );
}
