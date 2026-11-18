import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SentencePart } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { SpeakButton } from "@/features/speech/SpeakButton";

/** Each piece with a key of its own: where it starts, and what it is. */
function placed(
  parts: SentencePart[],
): Array<{ key: string; part: SentencePart }> {
  return parts.map((part, index) => {
    const start = parts
      .slice(0, index)
      .reduce((length, earlier) => length + earlier.text.length, 0);
    return { key: `${String(start)}${part.marked ? "w" : "s"}`, part };
  });
}

/** The sentence as the book has it. */
export function whole(parts: SentencePart[]): string {
  return parts.map((part) => part.text).join("");
}

interface ContextProps {
  parts: SentencePart[];
  /** The word is the answer: a blank stands where it was. */
  blanked: boolean;
  /** In the learner's language: there is no English in it to hear. */
  native?: boolean;
}

/**
 * The word's sentence from the book. The word stands out in it, or, when it
 * is what is being asked, a blank of one width stands in for it: how long
 * the word is says nothing.
 */
export function Context({
  parts,
  blanked,
  native = false,
}: ContextProps): ReactNode {
  const { t } = useTranslation();
  const word = (key: string, part: SentencePart): ReactNode =>
    blanked ? (
      <span
        key={key}
        data-blank
        className="mx-1 inline-block w-16 border-b border-ink-faint"
      >
        <span className="sr-only">{t("books.sitting.blank")}</span>
      </span>
    ) : (
      <mark
        key={key}
        className="rounded-sm bg-book-soft px-1 font-medium text-ink"
      >
        {part.text}
      </mark>
    );
  return (
    <p className="text-lead text-ink-soft">
      {placed(parts).map(({ key, part }) =>
        part.marked ? word(key, part) : <span key={key}>{part.text}</span>,
      )}
      <Presence>
        {!blanked && !native && (
          <Reveal key="blanked" as="span" kind="fade">
            <SpeakButton text={whole(parts)} className="ml-1" />
          </Reveal>
        )}
      </Presence>
    </p>
  );
}
