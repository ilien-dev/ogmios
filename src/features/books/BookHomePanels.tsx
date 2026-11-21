import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Book, Chapter, RecallState } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { BigNumber } from "@/components/scene/Stats";
import { Button } from "@/components/ui/Button";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { EASE_OUT, animated } from "@/lib/motion";
import { wordDots } from "./chapterChart";
import { chapterName } from "./chapterName";

/** How many dots the words of the learner fill at most. */
const DOTS = 60;

interface TranslateProps {
  book: Book;
  chapter: Chapter;
  nativeLang: string;
  navigate: Navigate;
}

/**
 * The other ways into the picked chapter, as a card beside it: translating
 * it both ways, which starts on the chapter's own screen where the order
 * holds, and its structures and its reading aloud.
 */
export function Translate({
  book,
  chapter,
  nativeLang,
  navigate,
}: TranslateProps): ReactNode {
  const { t } = useTranslation();
  const native = nativeLang.toUpperCase();
  const name = chapterName(chapter, t);
  const ways: Array<{ key: string; label: string; go: () => void }> = [
    {
      key: "listening",
      label: t("nav.entries.listening"),
      go: () => {
        navigate({ name: "listening", chapterId: chapter.id });
      },
    },
  ];
  if (chapter.prepared !== null) {
    ways.unshift({
      key: "structures",
      label: t("nav.entries.structures"),
      go: () => {
        navigate({ name: "structures", chapterId: chapter.id });
      },
    });
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-xl glass p-4">
      <section
        aria-labelledby="book-home-translate"
        className="flex flex-1 flex-col"
      >
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
          className="group flex flex-1 flex-col gap-2.5 text-left"
        >
          <span className="flex w-full items-start justify-between gap-2">
            <span
              id="book-home-translate"
              className="font-display text-base font-semibold tracking-tight text-ink"
            >
              {t("bookHome.translate.title")}
            </span>
            <ArrowUpRight
              aria-hidden
              className="size-4 shrink-0 text-ink-faint transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-text"
            />
          </span>
          <span className="relative block">
            <Swap
              id={chapter.id}
              as="div"
              className="line-clamp-2 font-mono text-xs text-ink-faint"
            >
              {name}
            </Swap>
          </span>
          <span className="flex items-center gap-1.5 py-2 font-mono text-xs font-bold">
            <span className="rounded-full bg-book-soft px-2 py-0.5 text-book-ink">
              EN
            </span>
            <ArrowRight aria-hidden className="size-3.5 text-ink-faint" />
            <span className="rounded-full bg-partner-soft px-2 py-0.5 text-partner">
              {native}
            </span>
            <ArrowRight aria-hidden className="size-3.5 text-ink-faint" />
            <span className="rounded-full bg-book-soft px-2 py-0.5 text-book-ink">
              EN
            </span>
          </span>
          <span className="text-sm text-ink-soft">
            {t("bookHome.translate.how")}
          </span>
        </button>
      </section>
      <nav
        aria-label={t("bookHome.board.ways", { chapter: name })}
        className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink-faint"
      >
        {ways.map((way, at) => (
          <span key={way.key} className="flex items-center gap-1.5">
            <Presence>
              {at > 0 && (
                <Reveal key="dot" as="span" kind="fade" aria-hidden>
                  ·
                </Reveal>
              )}
            </Presence>
            <button
              type="button"
              onClick={way.go}
              className="transition-control hover:text-accent-text"
            >
              {way.label}
            </button>
          </span>
        ))}
      </nav>
    </div>
  );
}

interface ReviewProps {
  due: number;
  state: RecallState | null;
  navigate: Navigate;
}

type Part = "fresh" | "settling" | "firm";

const PARTS: Array<[Part, string, "new" | "settling" | "firm"]> = [
  ["firm", "bg-book", "firm"],
  ["settling", "bg-accent", "settling"],
  ["fresh", "bg-line-strong", "new"],
];

/** What the daily recall asks today, and how strong the words it keeps are. */
export function Review({ due, state, navigate }: ReviewProps): ReactNode {
  const { t } = useTranslation();
  const most =
    state === null ? 0 : Math.max(state.fresh, state.settling, state.firm);
  return (
    <section
      aria-labelledby="book-home-review"
      className="flex flex-1 flex-wrap items-center gap-x-7 gap-y-3.5"
    >
      <div className="flex min-w-48 flex-col gap-0.5">
        <h2
          id="book-home-review"
          className="font-display text-base tracking-tight text-ink"
        >
          {t("bookHome.review.title")}
        </h2>
        <BigNumber
          value={due}
          size="md"
          unit={t("bookHome.board.today", { count: due })}
        />
        <p className="text-xs text-ink-faint">
          {due > 0 ? t("recall.due", { count: due }) : t("recall.nothingDue")}
        </p>
      </div>
      <Presence>
        {most > 0 && state !== null && (
          <Reveal
            key="strength"
            kind="fade"
            role="img"
            aria-label={t("bookHome.review.strength", {
              firm: state.firm,
              settling: state.settling,
              fresh: state.fresh,
            })}
            className="grid min-w-60 flex-1 grid-cols-3 gap-x-3.5 gap-y-1.5 text-sm"
          >
            {PARTS.map(([key, , label]) => (
              <span
                key={`${key}-label`}
                className="font-mono text-xs tracking-wider text-ink-faint uppercase"
              >
                {t(`recall.strength.${label}`)}
              </span>
            ))}
            {PARTS.map(([key]) => (
              <span key={`${key}-count`} className="font-mono text-ink">
                {state[key]}
              </span>
            ))}
            {PARTS.map(([key, color]) => (
              <span key={`${key}-bar`} className="h-1.5 rounded-full bg-raised">
                <motion.span
                  initial={animated() ? { scaleX: 0 } : false}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.3 }}
                  style={{ width: `${String((state[key] / most) * 100)}%` }}
                  className={cn("block h-full origin-left rounded-full", color)}
                />
              </span>
            ))}
          </Reveal>
        )}
      </Presence>
      <Button
        variant="primary"
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
      color: "bg-book/35",
    })),
  ];
  return (
    <section
      aria-labelledby="book-home-words"
      className="flex min-w-56 flex-col gap-2 wide:max-w-64"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="book-home-words"
          className="font-display text-base tracking-tight text-ink"
        >
          {t("bookHome.words.title")}
        </h2>
        <BigNumber
          value={learned + known}
          size="md"
          unit={t("bookHome.words.total", { count: learned + known })}
        />
      </div>
      <Presence>
        {cells.length > 0 && (
          <Reveal
            key="dots"
            kind="fade"
            role="img"
            aria-label={t("bookHome.words.dots", { learned, known })}
            className="grid grid-cols-20 gap-0.5"
          >
            {cells.map((cell, index) => (
              <motion.span
                key={cell.id}
                initial={animated() ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.2 + index * 0.01 }}
                className={cn("aspect-square rounded-full", cell.color)}
              />
            ))}
          </Reveal>
        )}
      </Presence>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-book" />
          {t("bookHome.words.learned", { count: learned })}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-book/35" />
          {t("bookHome.words.known", { count: known })}
        </li>
        <Presence>
          {dots.unit > 1 && (
            <Reveal key="unit" as="li" kind="fade">
              {t("bookHome.words.unit", { count: dots.unit })}
            </Reveal>
          )}
        </Presence>
      </ul>
    </section>
  );
}
