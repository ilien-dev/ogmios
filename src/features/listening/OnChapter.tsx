import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book } from "@shared/domain";
import type { ListeningChapter, Pace } from "@shared/listening";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { chapterName } from "@/features/books/chapterName";
import { PaceChoice } from "./PaceChoice";

interface OnChapterProps {
  on: ListeningChapter;
  books: readonly Book[];
  pace: Pace;
  busy: boolean;
  onPace: (pace: Pace) => void;
  onChapter: (chapterId: string) => void;
  onDictation: () => void;
  onListen: () => void;
}

/** The chapter the listening is on, and the two things to do with it. */
export function OnChapter({
  on,
  books,
  pace,
  busy,
  onPace,
  onChapter,
  onDictation,
  onListen,
}: OnChapterProps): ReactNode {
  const { t } = useTranslation();
  const left = on.place > 0;
  return (
    <section className="flex flex-col gap-4">
      <Field id="listening-chapter" label={t("listening.chapter.label")}>
        <Select
          id="listening-chapter"
          value={on.chapter.id}
          onChange={(event) => {
            onChapter(event.target.value);
          }}
        >
          {books.map((book) => (
            <optgroup key={book.id} label={book.title}>
              {book.chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapterName(chapter, t)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface py-1 shadow-card">
        <li className="flex flex-wrap items-center gap-4 px-5 py-4">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-medium text-ink">
              {t("listening.dictation.title")}
            </span>
            <span className="text-sm text-ink-soft">
              {t("listening.dictation.hint")}
            </span>
          </span>
          <PaceChoice value={pace} onChange={onPace} />
          <Button variant="primaryBook" disabled={busy} onClick={onDictation}>
            {t("listening.dictation.start")}
          </Button>
        </li>
        <li className="flex flex-wrap items-center gap-4 px-5 py-4">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-medium text-ink">
              {t("listening.listen.title")}
            </span>
            <span className="text-sm text-ink-soft tabular-nums">
              {left
                ? t("listening.listen.place", {
                    current: on.place + 1,
                    total: on.sentences,
                  })
                : t("listening.listen.fresh", { count: on.sentences })}
            </span>
          </span>
          <Button onClick={onListen}>
            {left
              ? t("listening.listen.continue")
              : t("listening.listen.start")}
          </Button>
        </li>
      </ul>
    </section>
  );
}
