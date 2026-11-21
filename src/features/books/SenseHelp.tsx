import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { PartOfSpeech, SenseHint, SenseTip } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import { TAG } from "./PartOfSpeechTag";

/** A kind of word that can be explained: not "other". */
type Kind = Exclude<PartOfSpeech, "other">;

function named(kind: PartOfSpeech | null): Kind | null {
  return kind === null || kind === "other" ? null : kind;
}

/**
 * The name of a kind of word in a sentence, written as the band of the card
 * names it, in capitals and its colour: the learner links the two.
 */
function KindMark({ kind }: { kind: Kind }): ReactNode {
  const { t } = useTranslation();
  return (
    <span
      data-kind-mark={kind}
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-extrabold tracking-widest uppercase",
        TAG[kind],
      )}
    >
      {t(`books.chapter.partOfSpeech.${kind}`)}
    </span>
  );
}

/**
 * Where the other meaning is from: a chapter of this book, by the name the
 * app shows it by, or another book.
 */
function place(hint: SenseHint, t: TFunction): string {
  if (hint.book !== null) {
    return t("books.sense.placeBook", { book: hint.book });
  }
  return hint.chapterTitle === ""
    ? t("books.sense.placeSection", { n: hint.chapter })
    : t("books.sense.placeChapter", { title: hint.chapterTitle });
}

/**
 * The second step of a word written alike to another one: what the answer
 * meant, and where; and when the two are different kinds of word, what each
 * kind is, with an example and the question that leads to the one asked.
 */
export function SenseHintCard({ hint }: { hint: SenseHint }): ReactNode {
  const { t } = useTranslation();
  const asked = named(hint.asked);
  const given = named(hint.given);
  const where = place(hint, t);
  const kinds = asked !== null && given !== null && asked !== given;
  return (
    <div
      data-sense-hint
      className="flex w-full flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-sunken/60 px-4 py-3 text-left text-ink"
    >
      <p>{t("books.sense.notThis", { meaning: hint.meaning, place: where })}</p>
      <Presence>
        {kinds && (
          <Reveal key="kinds" className="flex flex-col gap-2">
            <p>
              {t("books.sense.was", { place: where })}{" "}
              {t(`books.sense.kinds.${given}.article`)}{" "}
              <KindMark kind={given} />
              {": "}
              {t(`books.sense.kinds.${given}.does`)}
              {t("books.sense.likeYours", { meaning: hint.meaning })}
            </p>
            <p>
              {t("books.sense.is")} {t(`books.sense.kinds.${asked}.article`)}{" "}
              <KindMark kind={asked} />
              {": "}
              {t(`books.sense.kinds.${asked}.does`)}
              {t("books.sense.like", {
                example: t(`books.sense.kinds.${asked}.example`),
              })}
            </p>
            <p>
              {t("books.sense.ask")}{" "}
              <strong className="font-semibold">
                {t(`books.sense.kinds.${asked}.question`)}
              </strong>
            </p>
          </Reveal>
        )}
      </Presence>
    </div>
  );
}

/**
 * Right only with the sentence: what to look at next time. The tag beside
 * the word, when its rivals are another kind; otherwise the words around it.
 */
export function SenseTipLine({ tip }: { tip: SenseTip }): ReactNode {
  const { t } = useTranslation();
  const kind = named(tip.kind);
  // The tag tells the rivals apart only when they are another kind.
  const tagged = tip.kindsDiffer && kind !== null;
  return (
    <p data-sense-tip className="text-ink-soft">
      <strong className="font-semibold text-ink">
        {t("books.sense.tipTitle")}
      </strong>{" "}
      <Presence>
        {tagged && kind !== null && (
          <Reveal key="tag" as="span" kind="fade">
            {t("books.sense.tipTag")} <KindMark kind={kind} />
            {t("books.sense.tipTagEnd")}
          </Reveal>
        )}
        {!tagged && (
          <Reveal key="words" as="span" kind="fade">
            {t("books.sense.tipWords")}
          </Reveal>
        )}
      </Presence>
    </p>
  );
}
