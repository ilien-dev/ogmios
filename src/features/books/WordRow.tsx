import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleCheck, CircleDashedCheck } from "lucide-react";
import type { BookWord } from "@shared/domain";
import { Reveal } from "@/components/motion/Reveal";
import { STAGGER_LIMIT } from "@/lib/motion";
import { Button } from "@/components/ui/Button";
import { StrengthMark } from "@/features/recall/StrengthMark";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { PartOfSpeechTag } from "./PartOfSpeechTag";

interface WordRowProps {
  word: BookWord;
  /** Its place in the table, for the cascade it comes in with. */
  index: number;
  onKnown: (word: BookWord, known: boolean) => void;
}

/**
 * One word still to learn: what it is, its translations, its count and the way
 * to say it is known already. A row that leaves lets the others close the gap.
 */
export function WordRow({ word, index, onKnown }: WordRowProps): ReactNode {
  const { t } = useTranslation();
  /** What a word finished one way alone says of itself. */
  let half: string | undefined = undefined;
  if (word.half !== null) {
    half =
      word.half === "recognition"
        ? t("books.chapter.halfRecognition")
        : t("books.chapter.halfProduction");
  }
  return (
    <Reveal
      as="tr"
      kind="fade"
      index={index}
      layout={index < STAGGER_LIMIT ? "position" : false}
    >
      <th scope="row" className="px-2 py-3 font-medium text-ink">
        <span className="flex flex-col items-start gap-1">
          <span className="whitespace-nowrap">
            {word.lemma}
            <SpeakButton text={word.lemma} className="ml-1" />
          </span>
          {/* A label only ever arrives (`words::label`), so this needs no exit. */}
          <PartOfSpeechTag
            kind={word.partOfSpeech}
            className="animate-appear"
          />
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
            title={half}
            icon={
              word.half === null ? (
                <Check aria-hidden className="size-4" />
              ) : (
                <CircleDashedCheck
                  role="img"
                  aria-label={half}
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
    </Reveal>
  );
}
