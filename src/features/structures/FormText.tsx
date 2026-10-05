import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/Tooltip";
import { structuresEn } from "@/lib/i18n/structures.en";

type TermKey = keyof typeof structuresEn.terms;

const TERMS = Object.keys(structuresEn.terms).filter((key): key is TermKey =>
  Object.hasOwn(structuresEn.terms, key),
);

function escaped(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

interface FormTextProps {
  /** How a structure is built, in the language of the interface. */
  form: string;
}

/**
 * The form of a structure with each grammar word explained on the word
 * itself: "past participle" says what it is when hovered, focused or tapped.
 */
export function FormText({ form }: FormTextProps): ReactNode {
  const { t } = useTranslation();
  const hints: ReadonlyMap<string, string> = new Map(
    TERMS.map((key) => [
      t(`structures.terms.${key}.term`),
      t(`structures.terms.${key}.hint`),
    ]),
  );
  // The longest first: "verb-ing" is not "verb" followed by something else.
  const words = [...hints.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escaped);
  const terms = new RegExp(
    String.raw`(?<!\p{L})(${words.join("|")})(?!\p{L})`,
    "gu",
  );
  // With one group, every odd piece is a term and every even one the rest.
  const pieces = form.split(terms);
  return pieces.map((piece, index) => {
    const hint = index % 2 === 1 ? hints.get(piece) : undefined;
    const key = `${String(index)}-${piece}`;
    return hint === undefined ? (
      <span key={key}>{piece}</span>
    ) : (
      <Tooltip
        key={key}
        hint={hint}
        className="underline decoration-line-strong decoration-dotted underline-offset-4"
      >
        {piece}
      </Tooltip>
    );
  });
}
