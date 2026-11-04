import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { Book, Chapter, RecallState } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { EASE_OUT, animated } from "@/lib/motion";
import { wordDots } from "./chapterChart";
import { chapterName } from "./chapterName";

/** How many dots the words of the learner fill at most. */
const DOTS = 60;

/** A panel of the book's screen. */
export const PANEL = "rounded-lg bg-surface p-5 shadow-card";

interface TranslateProps {
  book: Book;
  chapter: Chapter;
  nativeLang: string;
  navigate: Navigate;
}

/** Both directions start on the chapter's own screen, where the order holds. */
export function Translate({
  book,
  chapter,
  nativeLang,
  navigate,
}: TranslateProps): ReactNode {
  const { t } = useTranslation();
  const native = nativeLang.toUpperCase();
  return (
    <section
      aria-labelledby="book-home-translate"
      className={cn(PANEL, "flex flex-1 flex-col")}
    >
      <h2
        id="book-home-translate"
        className="mb-3 text-lg font-semibold text-ink"
      >
        {t("bookHome.translate.title")}
      </h2>
      <button
        type="button"
        onClick={() => {
          navigate({
            name: "books",
            bookId: book.id,
            chapterId: chapter.id,
            translating: true,
          });
        }}
        className="group flex w-full flex-1 flex-wrap items-center justify-between gap-3 rounded-md bg-sunken p-4 text-left transition-control hover:bg-raised"
      >
        <span className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-sm font-bold">
            <span className="rounded-sm bg-book-soft px-2 py-0.5 text-book-ink">
              EN
            </span>
            <ArrowRight aria-hidden className="size-4 text-ink-soft" />
            <span className="rounded-sm bg-partner-soft px-2 py-0.5 text-partner">
              {native}
            </span>
            <ArrowRight aria-hidden className="size-4 text-ink-soft" />
            <span className="rounded-sm bg-book-soft px-2 py-0.5 text-book-ink">
              EN
            </span>
          </span>
          <span className="text-sm text-ink-soft">
            {t("bookHome.translate.how")}
          </span>
        </span>
        <span className="flex items-center gap-1 text-sm font-medium text-ink">
          {chapterName(chapter, t)}
          <ArrowRight
            aria-hidden
            className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-1"
          />
        </span>
      </button>
    </section>
  );
}

interface ReviewProps {
  due: number;
  state: RecallState | null;
  navigate: Navigate;
}

/** What the daily recall asks today, and how strong the words it keeps are. */
export function Review({ due, state, navigate }: ReviewProps): ReactNode {
  const { t } = useTranslation();
  const total = state === null ? 0 : state.fresh + state.settling + state.firm;
  const parts: Array<
    ["fresh" | "settling" | "firm", string, "new" | "settling" | "firm"]
  > = [
    ["firm", "bg-book", "firm"],
    ["settling", "bg-tally-fill", "settling"],
    ["fresh", "bg-line-strong", "new"],
  ];
  return (
    <section
      aria-labelledby="book-home-review"
      className={cn(PANEL, "flex flex-1 flex-col gap-3")}
    >
      <h2 id="book-home-review" className="text-lg font-semibold text-ink">
        {t("bookHome.review.title")}
      </h2>
      <p className="text-sm text-ink-soft">
        {due > 0 ? t("recall.due", { count: due }) : t("recall.nothingDue")}
      </p>
      <Presence>
        {total > 0 && state !== null && (
          <Reveal key="strength" kind="fade" className="flex flex-col gap-2">
            <div
              role="img"
              aria-label={t("bookHome.review.strength", {
                firm: state.firm,
                settling: state.settling,
                fresh: state.fresh,
              })}
              className="flex h-2 overflow-hidden rounded-full bg-raised"
            >
              {parts.map(([key, color]) => (
                <motion.span
                  key={key}
                  initial={animated() ? { scaleX: 0 } : false}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.8, ease: EASE_OUT }}
                  style={{ width: `${String((state[key] / total) * 100)}%` }}
                  className={cn("origin-left", color)}
                />
              ))}
            </div>
            <ul className="flex flex-wrap gap-3 text-xs text-ink-soft">
              {parts.map(([key, color, label]) => (
                <li key={key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn("size-2.5 rounded-sm", color)}
                  />
                  {t(`recall.strength.${label}`)} {state[key]}
                </li>
              ))}
            </ul>
          </Reveal>
        )}
      </Presence>
      <Button
        variant="primaryBook"
        className="mt-auto"
        onClick={() => {
          navigate({ name: "recall" });
        }}
      >
        {due > 0
          ? t("bookHome.review.start", { count: due })
          : t("bookHome.review.open")}
      </Button>
    </section>
  );
}

interface WordsProps {
  learned: number;
  known: number;
}

/** Every word the learner has: learned here, or known from before. */
export function Words({ learned, known }: WordsProps): ReactNode {
  const { t } = useTranslation();
  const dots = wordDots(learned, known, DOTS);
  const cells = [
    ...Array.from({ length: dots.learned }, (_, at) => ({
      id: `learned-${String(at)}`,
      color: "bg-book",
    })),
    ...Array.from({ length: dots.known }, (_, at) => ({
      id: `known-${String(at)}`,
      color: "bg-book-soft",
    })),
  ];
  return (
    <section
      aria-labelledby="book-home-words"
      className={cn(PANEL, "flex flex-1 flex-col gap-3")}
    >
      <h2 id="book-home-words" className="text-lg font-semibold text-ink">
        {t("bookHome.words.title")}
      </h2>
      <p className="text-sm text-ink-soft">
        <span className="text-3xl font-light tracking-tight text-ink">
          {learned + known}
        </span>{" "}
        {t("bookHome.words.total", { count: learned + known })}
      </p>
      <Presence>
        {cells.length > 0 && (
          <Reveal
            key="dots"
            kind="fade"
            role="img"
            aria-label={t("bookHome.words.dots", { learned, known })}
            className="grid grid-cols-12 gap-1"
          >
            {cells.map((cell, index) => (
              <motion.span
                key={cell.id}
                initial={animated() ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.2 + index * 0.01 }}
                className={cn("aspect-square rounded-sm", cell.color)}
              />
            ))}
          </Reveal>
        )}
      </Presence>
      <ul className="flex flex-wrap gap-3 text-xs text-ink-soft">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-book" />
          {t("bookHome.words.learned", { count: learned })}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-book-soft" />
          {t("bookHome.words.known", { count: known })}
        </li>
      </ul>
      <Presence>
        {dots.unit > 1 && (
          <Reveal
            key="unit"
            as="p"
            kind="fade"
            className="text-xs text-ink-faint"
          >
            {t("bookHome.words.unit", { count: dots.unit })}
          </Reveal>
        )}
      </Presence>
    </section>
  );
}
