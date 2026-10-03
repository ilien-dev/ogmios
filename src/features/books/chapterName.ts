import type { TFunction } from "i18next";
import type { Chapter } from "@shared/domain";

/** What a chapter is called by its place, when the book gives it no name. */
export function chapterPlaceName(chapter: Chapter, t: TFunction): string {
  return t("books.section", { number: chapter.index + 1 });
}

/** The chapter's name: its own, or the one its place gives it. */
export function chapterName(chapter: Chapter, t: TFunction): string {
  return chapter.title === "" ? chapterPlaceName(chapter, t) : chapter.title;
}
