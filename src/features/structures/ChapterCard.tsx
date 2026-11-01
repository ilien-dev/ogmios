import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChapterStructures } from "@shared/structures";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { chapterName } from "@/features/books/chapterName";
import { ScanProgress, useChapterScan } from "./ChapterScan";

interface ChapterCardProps {
  found: ChapterStructures;
  names: ReadonlyMap<string, string>;
  /** To the chapter's structures, to practise them. */
  onOpen: () => void;
}

/**
 * The chapter the learner is on, and the structures it uses most. Until it
 * was read for them the card offers to read it, and does so in place, with
 * the reading in sight.
 */
export function ChapterCard({
  found: stored,
  names,
  onOpen,
}: ChapterCardProps): ReactNode {
  const { t } = useTranslation();
  const scan = useChapterScan(stored.chapter.id);
  const found = scan.found ?? stored;
  return (
    <section className="flex flex-col items-start gap-4 rounded-xl bg-surface p-6 shadow-card">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-ink-faint">
          {t("structures.chapter.book", {
            book: found.bookTitle,
            chapter: chapterName(found.chapter, t),
          })}
        </p>
        <h2 className="text-lead font-semibold text-ink">
          {t("structures.chapter.title")}
        </h2>
      </header>
      <Presence>
        {found.structures.length > 0 && (
          <Reveal key="used">
            <ul className="flex flex-wrap gap-2">
              {found.structures.map((each) => (
                <li
                  key={each.key}
                  className="rounded-full bg-raised px-3 py-1 text-sm text-ink-soft"
                >
                  <span className="font-medium text-ink">
                    {names.get(each.key) ?? each.key}
                  </span>
                  {" · "}
                  {t("structures.chapter.count", { count: each.count })}
                </li>
              ))}
            </ul>
          </Reveal>
        )}
        {found.scanned && found.structures.length === 0 && (
          <Reveal
            as="p"
            key="none"
            kind="fade"
            className="text-sm text-ink-soft"
          >
            {t("structures.chapter.none")}
          </Reveal>
        )}
        {scan.failure !== null && (
          <Notice key="failure" tone="danger">
            {t("common.error", { message: scan.failure })}
          </Notice>
        )}
        {scan.reading && (
          <Reveal key="reading" className="w-full">
            <ScanProgress progress={scan.progress} />
          </Reveal>
        )}
        {!found.scanned && !scan.reading && (
          <Reveal key="find" className="flex flex-col items-start gap-4">
            <p className="text-sm text-ink-soft">
              {t("structures.chapter.findHint")}
            </p>
            <Button variant="primaryBook" onClick={scan.read}>
              {t("structures.chapter.find")}
            </Button>
          </Reveal>
        )}
        {found.structures.length > 0 && (
          <Reveal key="practise" kind="fade">
            <Button variant="primaryBook" onClick={onOpen}>
              {t("structures.chapter.practise")}
            </Button>
          </Reveal>
        )}
      </Presence>
    </section>
  );
}
