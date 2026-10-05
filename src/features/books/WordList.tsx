import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleCheck, CircleDashedCheck } from "lucide-react";
import type { BookWord } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StrengthMark } from "@/features/recall/StrengthMark";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { PartOfSpeechTag } from "./PartOfSpeechTag";
import { Tally } from "./Tally";

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
    return <p className="text-ink-soft">{t("books.chapter.noWords")}</p>;
  }
  /** What a word finished one way alone says of itself. */
  const half = (word: BookWord): string | undefined => {
    if (word.half === null) {
      return undefined;
    }
    return word.half === "recognition"
      ? t("books.chapter.halfRecognition")
      : t("books.chapter.halfProduction");
  };
  const toLearn = words.filter((word) => !word.known);
  const known = words.filter((word) => word.known);
  const open = toLearn.filter((word) => !word.done).length;
  const learned = toLearn.length - open;
  return (
    <div className="flex w-full flex-col gap-6">
      {toLearn.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <Tally dot="bg-accent">
              {t("books.chapter.learnedCount", { count: learned })}
            </Tally>
            {open > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Tally dot="bg-line-strong">
                  {t("books.chapter.wordCount", { count: open })}
                </Tally>
                {onTriage !== undefined && (
                  <Button size="sm" onClick={onTriage}>
                    {t("books.triage.start")}
                  </Button>
                )}
              </div>
            )}
          </div>
          <ProgressBar
            label={t("books.chapter.learnedBar")}
            value={learned}
            total={toLearn.length}
          />
        </div>
      )}
      {toLearn.length > 0 && (
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
          <tbody className="divide-y divide-line border-b border-line">
            {toLearn.map((word) => (
              <tr key={word.id}>
                <th scope="row" className="px-2 py-3 font-medium text-ink">
                  <span className="flex flex-col items-start gap-1">
                    <span className="whitespace-nowrap">
                      {word.lemma}
                      <SpeakButton text={word.lemma} className="ml-1" />
                    </span>
                    <PartOfSpeechTag kind={word.partOfSpeech} />
                  </span>
                </th>
                <td className="px-2 py-3 text-ink-soft">
                  {word.translations.join(", ")}
                </td>
                <td className="px-2 py-3 text-right text-ink-faint tabular-nums">
                  {word.count}
                </td>
                <td className="px-2 py-1 text-right">
                  {word.done ? (
                    <span className="mr-2 inline-flex items-center gap-2">
                      {word.strength !== null && (
                        <StrengthMark strength={word.strength} />
                      )}
                      <CircleCheck
                        role="img"
                        aria-label={t("books.chapter.done")}
                        className="size-4 text-accent-text"
                      />
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2 text-ink-faint"
                      aria-label={t("books.chapter.know", { word: word.lemma })}
                      title={half(word)}
                      icon={
                        word.half === null ? (
                          <Check aria-hidden className="size-4" />
                        ) : (
                          <CircleDashedCheck
                            role="img"
                            aria-label={half(word)}
                            className="size-4 text-accent-text"
                          />
                        )
                      }
                      onClick={() => {
                        onKnown(word, true);
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {known.length > 0 && (
        <details className="text-sm text-ink-soft">
          <summary className="cursor-pointer py-1 text-ink-faint hover:text-ink">
            {t("books.chapter.knownCount", { count: known.length })}
          </summary>
          <ul className="flex flex-col divide-y divide-line pt-2">
            {known.map((word) => (
              <li key={word.id} className="flex items-center gap-4 px-2 py-1">
                <span className="font-medium">{word.lemma}</span>
                <span className="min-w-0 flex-1 truncate text-ink-faint">
                  {word.translations.join(", ")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("books.chapter.undoWord", { word: word.lemma })}
                  onClick={() => {
                    onKnown(word, false);
                  }}
                >
                  {t("books.chapter.undo")}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
