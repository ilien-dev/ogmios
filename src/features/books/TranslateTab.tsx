import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Chapter } from "@shared/domain";
import type { Navigate } from "@/app/routes";
import { languageName } from "@/lib/text";
import { TranslateStart } from "./TranslateStart";

interface TranslateTabProps {
  book: Book;
  /** The chapter the learner is on. */
  chapter: Chapter;
  /** The learner's first language: what the chapter is translated into. */
  nativeLang: string;
  navigate: Navigate;
}

/**
 * Translating the chapter the learner is on, as a tab of the book: a new
 * attempt in one direction, or one of the attempts kept. Whichever is opened
 * takes the whole window.
 */
export function TranslateTab({
  book,
  chapter,
  nativeLang,
  navigate,
}: TranslateTabProps): ReactNode {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-medium tracking-tight text-ink">
        {t("books.translate.title")}
      </h2>
      <TranslateStart
        chapterId={chapter.id}
        native={languageName(nativeLang, i18n.language)}
        onOpen={(attempt) => {
          navigate({
            name: "books",
            bookId: book.id,
            chapterId: chapter.id,
            translating: attempt,
          });
        }}
      />
    </div>
  );
}
