import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleCheck } from "lucide-react";
import type { BookWord } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { SpeakButton } from "@/features/speech/SpeakButton";

interface WordListProps {
  words: BookWord[];
  /** The learner knows this word already, or takes that back. */
  onKnown: (word: BookWord, known: boolean) => void;
}

/**
 * The chapter's words: each with its translations and its count, and a way
 * to say "I know this". The words set aside that way stay below, folded, so
 * that any of them can be taken back.
 */
export function WordList({ words, onKnown }: WordListProps): ReactNode {
  const { t } = useTranslation();
  if (words.length === 0) {
    return <p className="text-ink-soft">{t("books.chapter.noWords")}</p>;
  }
  const toLearn = words.filter((word) => !word.known);
  const known = words.filter((word) => word.known);
  const open = toLearn.filter((word) => !word.done).length;
  return (
    <div className="flex w-full flex-col gap-6">
      {toLearn.length > 0 && (
        <table className="w-full text-left">
          {open > 0 && (
            <caption className="pb-4 text-left text-sm font-medium text-ink-faint">
              {t("books.chapter.wordCount", { count: open })}
            </caption>
          )}
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
                  {word.lemma}
                  <SpeakButton text={word.lemma} className="ml-1" />
                </th>
                <td className="px-2 py-3 text-ink-soft">
                  {word.translations.join(", ")}
                </td>
                <td className="px-2 py-3 text-right text-ink-faint tabular-nums">
                  {word.count}
                </td>
                <td className="px-2 py-1 text-right">
                  {word.done ? (
                    <CircleCheck
                      role="img"
                      aria-label={t("books.chapter.done")}
                      className="mr-2 inline size-4 text-accent-text"
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2 text-ink-faint"
                      aria-label={t("books.chapter.know", { word: word.lemma })}
                      icon={<Check aria-hidden className="size-4" />}
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
